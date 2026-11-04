import { mkdtemp, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';

import { startServerLight } from '../process/serverLight';
import { createRunDirs } from '../runDir';
import { runDeskServerFixture } from './deskServer';

// Process startup is substituted; the fixture's port guard and filesystem cleanup are real.
vi.mock('../process/serverLight', () => ({ startServerLight: vi.fn() }));
const directories: string[] = [];
afterEach(async () => {
    await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })));
    vi.resetAllMocks();
});

it.each(['normal', 'stop failure', 'forbidden port'] as const)('removes the disposable database on %s', async kind => {
    const dataDir = await mkdtemp(join(tmpdir(), 'desk-server-cleanup-'));
    directories.push(dataDir);
    let stopped = false;
    vi.mocked(startServerLight).mockResolvedValue({
        baseUrl: `http://127.0.0.1:${kind === 'forbidden port' ? 3005 : 23456}`,
        dataDir,
        stop: async () => { stopped = true; if (kind === 'stop failure') throw new Error('Synthetic stop failure'); },
    } as Awaited<ReturnType<typeof startServerLight>>);
    const logsDir = await mkdtemp(join(tmpdir(), 'desk-cleanup-logs-'));
    directories.push(logsDir);
    const run = runDeskServerFixture(createRunDirs({ logsDir }), {}, async getServer => { await getServer('desk.j2.spec.ts', 'e2ee'); });
    if (kind === 'normal') await run;
    else await expect(run).rejects.toThrow(kind === 'stop failure' ? 'Synthetic stop failure' : /3005/);
    expect(stopped).toBe(true);
    const removed = await access(dataDir).then(() => false, () => true);
    expect(removed, 'runtime database removed even on the failure path').toBe(true);
});
