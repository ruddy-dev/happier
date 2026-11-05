import { EventEmitter } from 'node:events';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { expect, test, vi } from 'vitest';

// The sandbox cannot listen on loopback. Replace only the HTTP socket boundary;
// requests still execute the owner's real static-file and runtime-config handler.
const httpBoundary = vi.hoisted(() => ({
    handler: undefined as ((req: IncomingMessage, res: ServerResponse) => void) | undefined,
}));
vi.mock('node:http', async (original) => {
    const actual = await original<typeof import('node:http')>();
    return {
        ...actual,
        createServer: (handler: (req: IncomingMessage, res: ServerResponse) => void) => {
            httpBoundary.handler = handler;
            return Object.assign(new EventEmitter(), {
                listen: (_port: number, _host: string, ready: () => void) => ready(),
                close: (closed: () => void) => closed(),
            });
        },
    };
});

async function requestExport(path = '/') {
    const body = new PassThrough();
    const chunks: Buffer[] = [];
    let status = 0;
    body.on('data', (chunk: Buffer) => chunks.push(chunk));
    const ended = new Promise<void>((resolve, reject) => {
        body.on('end', resolve);
        body.on('error', reject);
    });
    const response = Object.assign(body, {
        writeHead: (code: number) => { status = code; },
    });
    if (!httpBoundary.handler) throw new Error('Static HTTP server did not start');
    // Minimal HTTP transport fixtures; the owner's request handler remains real.
    httpBoundary.handler({ method: 'GET', url: path } as IncomingMessage, response as unknown as ServerResponse);
    await ended;
    return { status, text: Buffer.concat(chunks).toString('utf8') };
}

// Only the OS subprocess boundary is replaced. Cache decisions, locks and files stay real.
vi.mock('node:child_process', async (original) => {
    const actual = await original<typeof import('node:child_process')>();
    return { ...actual, spawn: vi.fn() };
});

test('rebuild bypasses both persisted and in-process exports on successive calls', async () => {
    const root = mkdtempSync(join(tmpdir(), 'desk-rebuild-'));
    const env = { HAPPIER_E2E_UI_WEB_EXPORT_NAMESPACE: join(root, 'export'), RCT_METRO_PORT: '23456' };
    let builds = 0;
    vi.mocked(spawn).mockImplementation((_command, args) => {
        const outputIndex = args?.indexOf('--output-dir') ?? -1;
        if (outputIndex < 0 || !args) throw new Error('Expected an export command');
        const outputDir = args[outputIndex + 1];
        mkdirSync(outputDir, { recursive: true });
        writeFileSync(join(outputDir, 'index.html'), `build ${++builds}`);
        const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough() });
        setImmediate(() => {
            child.stdout.end();
            child.stderr.end();
            child.emit('exit', 0, null);
        });
        // Partial ChildProcess models only the pipes and events consumed by runLoggedCommand.
        return child as unknown as ChildProcess;
    });
    try {
        let owner = await import('./uiWebExport');
        const initial = await owner.ensureUiWebExportBuilt({ testDir: root, env });
        expect(readFileSync(join(initial, 'index.html'), 'utf8')).toBe('build 1');
        await owner.ensureUiWebExportBuilt({ testDir: root, env });
        expect(builds).toBe(1);
        vi.resetModules();
        owner = await import('./uiWebExport');
        await owner.ensureUiWebExportBuilt({ testDir: root, env });
        expect(builds).toBe(1); // The new module reused the persisted cache.
        vi.resetModules();
        owner = await import('./uiWebExport');
        for (let expected = 2; expected <= 3; expected++) {
            const dist = await owner.ensureUiWebExportBuilt({ testDir: root, env, rebuild: true });
            expect(readFileSync(join(dist, 'index.html'), 'utf8')).toBe(`build ${expected}`);
        }
        expect(owner.isUiWebExportCurrent(env)).toBe(true);
    } finally {
        vi.mocked(spawn).mockReset();
        rmSync(root, { recursive: true, force: true });
    }
});


// Include file identity as well as bytes so replacement with identical data is visible.
function snapshotExport(root: string): unknown {
    if (!existsSync(root)) return null;
    return readdirSync(root).sort().map((name) => {
        const path = join(root, name);
        const stats = statSync(path);
        return stats.isDirectory()
            ? { name, children: snapshotExport(path) }
            : { name, bytes: readFileSync(path).toString('base64'), ino: stats.ino, mtimeMs: stats.mtimeMs };
    });
}

async function withExportFixture(run: (fixture: {
    root: string;
    env: NodeJS.ProcessEnv;
    owner: typeof import('./uiWebExport');
}) => Promise<void>): Promise<void> {
    const root = mkdtempSync(join(tmpdir(), 'desk-serving-'));
    const env = { HAPPIER_E2E_UI_WEB_EXPORT_NAMESPACE: join(root, 'export'), RCT_METRO_PORT: '23456' };
    vi.resetModules();
    vi.mocked(spawn).mockImplementation((_command, args) => {
        const outputIndex = args?.indexOf('--output-dir') ?? -1;
        if (outputIndex < 0 || !args) throw new Error('Unexpected process spawn');
        const outputDir = args[outputIndex + 1];
        mkdirSync(outputDir, { recursive: true });
        writeFileSync(join(outputDir, 'index.html'), '<html><head></head><body>retained export</body></html>');
        writeFileSync(join(outputDir, 'asset.js'), 'globalThis.retained = true;');
        const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough() });
        setImmediate(() => {
            child.stdout.end();
            child.stderr.end();
            child.emit('exit', 0, null);
        });
        // OS process fixture implements the pipes and events consumed by runLoggedCommand.
        return child as unknown as ChildProcess;
    });
    try {
        await run({ root, env, owner: await import('./uiWebExport') });
    } finally {
        vi.mocked(spawn).mockReset();
        rmSync(root, { recursive: true, force: true });
    }
}

test('serve-only uses a persisted export and injects the current relay URL without changing export files', async () => {
    await withExportFixture(async ({ root, env, owner }) => {
        await owner.ensureUiWebExportBuilt({ testDir: root, env });
        const retained = snapshotExport(join(root, 'export'));
        vi.mocked(spawn).mockClear();
        vi.resetModules();
        const persistedOwner = await import('./uiWebExport');
        const params = {
            testDir: root,
            port: 23457,
            env: {
                ...env,
                EXPO_PUBLIC_HAPPY_SERVER_URL: 'http://127.0.0.1:4012',
                EXPO_PUBLIC_HAPPIER_SYNC_TUNING_JSON: '{"profile":"test"}',
                HAPPIER_E2E_UI_WEB_EXPORT_FALLBACK_TO_METRO: '1',
            },
            allowBuild: false,
        };
        expect(persistedOwner.isUiWebExportCurrent(params.env)).toBe(true);
        const server = await persistedOwner.startUiWebExport(params);
        try {
            expect(server.proc).toBeNull();
            const html = (await requestExport()).text;
            expect(html).toContain('retained export');
            expect(html).toContain('window.__HAPPIER_WEB_RUNTIME_CONFIG__={"serverUrl":"http://127.0.0.1:4012"}');
            expect(html).toContain('HAPPIER_SYNC_TUNING_JSON');
            expect(html).toContain('profile');
            const asset = await requestExport('/asset.js');
            expect(asset.status).toBe(200);
            expect(asset.text).toBe('globalThis.retained = true;');
            expect(vi.mocked(spawn)).not.toHaveBeenCalled();
            expect(snapshotExport(join(root, 'export'))).toEqual(retained);
        } finally {
            await server.stop();
        }
    });
});

test.each(['missing export', 'missing index', 'missing manifest', 'stale source fingerprint', 'stale build env', 'explicit rebuild'])(
    'serve-only rejects %s at the serving boundary without spawning or replacing the export', async (scenario) => {
        await withExportFixture(async ({ root, env, owner }) => {
            if (scenario !== 'missing export') {
                await owner.ensureUiWebExportBuilt({ testDir: root, env });
                // This is the earlier desk admission check. Keep this owner's in-process cache warm.
                expect(owner.isUiWebExportCurrent(env)).toBe(true);
            }
            if (scenario === 'missing index') unlinkSync(join(root, 'export/dist/index.html'));
            if (scenario === 'missing manifest') unlinkSync(join(root, 'export/export-manifest.json'));
            if (scenario === 'stale source fingerprint') {
                const path = join(root, 'export/cache-key.json');
                const persisted = JSON.parse(readFileSync(path, 'utf8')) as { cacheKey: string };
                const key = JSON.parse(persisted.cacheKey) as { sourceFingerprint: string };
                key.sourceFingerprint = 'outdated-source';
                writeFileSync(path, JSON.stringify({ cacheKey: JSON.stringify(key) }));
            }
            const params = {
                testDir: root,
                port: 23457,
                env: {
                    ...env,
                    ...(scenario === 'stale build env' ? { EXPO_PUBLIC_DEBUG: 'changed' } : {}),
                    HAPPIER_E2E_UI_WEB_EXPORT_FALLBACK_TO_METRO: '1',
                },
                allowBuild: false,
                rebuild: scenario === 'explicit rebuild',
            };
            const retained = snapshotExport(join(root, 'export'));
            vi.mocked(spawn).mockClear();
            // Stop an incorrectly accepted server too, so RED leaves no listener behind.
            const attempt = owner.startUiWebExport(params).then(async (server) => {
                await server.stop();
            });
            await expect(attempt).rejects.toThrow(scenario === 'explicit rebuild' ? /rebuild/i : /missing|stale/i);
            expect(vi.mocked(spawn)).not.toHaveBeenCalled();
            expect(snapshotExport(join(root, 'export'))).toEqual(retained);
        });
    },
);

test('the default serving path still builds a missing export and serves its output', async () => {
    await withExportFixture(async ({ root, env, owner }) => {
        const server = await owner.startUiWebExport({ testDir: root, env, port: 23457 });
        try {
            expect(vi.mocked(spawn)).toHaveBeenCalledOnce();
            expect(owner.isUiWebExportCurrent(env)).toBe(true);
            expect((await requestExport()).text).toContain('retained export');
        } finally {
            await server.stop();
        }
    });
});
