import { EventEmitter } from 'node:events';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { expect, test, vi } from 'vitest';

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
