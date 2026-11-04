import { mkdir, rm } from 'node:fs/promises';
import { basename } from 'node:path';

import { startServerLight, ServerLightStartupError, type StartedServer } from '../process/serverLight';
import type { RunDirs } from '../runDir';
import { assertServerPort } from './originGuard';

export type DeskServerForFile = (file: string, mode: 'plain' | 'e2ee') => Promise<StartedServer>;

/** Worker fixture lifetime, including cleanup after startup validation failures. */
export async function runDeskServerFixture(
    run: RunDirs,
    plainEnv: NodeJS.ProcessEnv,
    use: (getServer: DeskServerForFile) => Promise<void>,
): Promise<void> {
    let current: Readonly<{ file: string; mode: 'plain' | 'e2ee'; server: StartedServer }> | null = null;
    let stopPromise: Promise<void> | null = null;
    let unresolvedStartup: ServerLightStartupError | null = null;
    const stop = async () => {
        if (!current) return;
        const { server } = current;
        // Reuse a failed stop as well: catching it must not allow a replacement
        // server or a second cleanup attempt to discard unresolved ownership.
        stopPromise ??= (async () => {
            await server.stop();
            await rm(server.dataDir, { recursive: true, force: true });
            current = null;
        })();
        await stopPromise;
    };
    try { await use(async (file, mode) => {
        if (unresolvedStartup) throw unresolvedStartup;
        if (stopPromise) await stopPromise;
        if (current?.file === file && current.mode === mode) return current.server;
        await stop();
        current = null;
        stopPromise = null;
        const testDir = run.testDir(`${basename(file)}-${mode}`);
        await mkdir(testDir, { recursive: true });
        let server: StartedServer;
        try { server = await startServerLight({ testDir, dbProvider: 'sqlite', extraEnv: mode === 'plain' ? plainEnv : {
            HAPPIER_SERVER_LOG_LEVEL: 'silent',
            HAPPIER_FEATURE_AUTH_LOGIN__KEY_CHALLENGE_ENABLED: '1',
            HAPPIER_FEATURE_ENCRYPTION__STORAGE_POLICY: 'required',
            HAPPIER_FEATURE_ENCRYPTION__DEFAULT_ACCOUNT_MODE: 'e2ee',
        } }); } catch (error) {
            if (error instanceof ServerLightStartupError) {
                if (error.terminationConfirmed) await rm(error.dataDir, { recursive: true, force: true });
                else unresolvedStartup = error;
            }
            throw error;
        }
        current = { file, mode, server };
        assertServerPort(Number(new URL(server.baseUrl).port));
        return server;
    }); } finally {
        await stop();
        if (unresolvedStartup) throw unresolvedStartup;
    }
}
