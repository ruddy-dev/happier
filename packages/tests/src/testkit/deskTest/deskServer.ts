import { mkdir, rm } from 'node:fs/promises';
import { basename } from 'node:path';

import { startServerLight, type StartedServer } from '../process/serverLight';
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
    const stop = async () => {
        if (!current) return;
        const { server } = current;
        current = null;
        try { await server.stop(); } finally {
            // Runtime databases hold ciphertext and auth material, never retain them as artifacts.
            await rm(server.dataDir, { recursive: true, force: true });
        }
    };
    try { await use(async (file, mode) => {
        if (current?.file === file && current.mode === mode) return current.server;
        await stop();
        current = null;
        const testDir = run.testDir(`${basename(file)}-${mode}`);
        await mkdir(testDir, { recursive: true });
        const server = await startServerLight({ testDir, dbProvider: 'sqlite', extraEnv: mode === 'plain' ? plainEnv : {
            HAPPIER_SERVER_LOG_LEVEL: 'silent',
            HAPPIER_FEATURE_AUTH_LOGIN__KEY_CHALLENGE_ENABLED: '1',
            HAPPIER_FEATURE_ENCRYPTION__STORAGE_POLICY: 'required',
            HAPPIER_FEATURE_ENCRYPTION__DEFAULT_ACCOUNT_MODE: 'e2ee',
        } });
        current = { file, mode, server };
        assertServerPort(Number(new URL(server.baseUrl).port));
        return server;
    }); } finally { await stop(); }
}
