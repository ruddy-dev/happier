import * as childProcess from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    resolveProcessOwnershipLeasesDir,
    sweepProcessOwnershipLeases,
} from './processOwnershipLease';

vi.mock('node:child_process', () => ({ spawnSync: vi.fn() }));

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('process ownership leases', () => {
    it('reclaims a stale owned process lease when the owner is gone and the child start time still matches', async () => {
        const rootDir = await mkdtemp(join(tmpdir(), 'happier-owned-process-lease-'));
        try {
            const leaseDir = resolveProcessOwnershipLeasesDir({ rootDir, leaseKind: 'generic-worker' });
            await mkdir(leaseDir, { recursive: true });

            const markerPath = join(leaseDir, 'pid-8123.json');
            await writeFile(
                markerPath,
                JSON.stringify({
                    childPid: 8123,
                    childStartTime: 'Tue Mar 18 10:10:10 2026',
                    ownerPid: 9001,
                    ownerStartTime: 'Tue Mar 18 09:09:09 2026',
                    createdAtMs: 123,
                    metadata: { purpose: 'test' },
                }),
                'utf8',
            );

            const terminateProcessTreeByPid = vi.fn(async () => {});
            const inspectProcess = vi.fn((pid: number) => {
                if (pid === 9001) {
                    return { ok: false as const, reason: 'not_found' as const };
                }
                if (pid === 8123) {
                    return {
                        ok: true as const,
                        command: 'node /tmp/fake-worker.js --label generic-worker',
                        startTime: 'Tue Mar 18 10:10:10 2026',
                    };
                }
                return { ok: false as const, reason: 'inspect_failed' as const };
            });

            await sweepProcessOwnershipLeases({
                rootDir,
                leaseKind: 'generic-worker',
                currentOwnerPid: 1337,
                currentOwnerStartTime: 'Tue Mar 18 11:11:11 2026',
                inspectProcess,
                terminateProcessTreeByPid,
                isOwnedProcessCommand: (command) => command.includes('generic-worker'),
            });

            expect(terminateProcessTreeByPid).toHaveBeenCalledTimes(1);
            expect(terminateProcessTreeByPid).toHaveBeenCalledWith(8123, expect.any(Object));
            await expect(readFile(markerPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
        } finally {
            await rm(rootDir, { recursive: true, force: true });
        }
    });

    it('keeps a lease marker when the child pid no longer matches the stored start time', async () => {
        const rootDir = await mkdtemp(join(tmpdir(), 'happier-owned-process-lease-mismatch-'));
        try {
            const leaseDir = resolveProcessOwnershipLeasesDir({ rootDir, leaseKind: 'generic-worker' });
            await mkdir(leaseDir, { recursive: true });

            const markerPath = join(leaseDir, 'pid-8125.json');
            await writeFile(
                markerPath,
                JSON.stringify({
                    childPid: 8125,
                    childStartTime: 'Tue Mar 18 14:14:14 2026',
                    ownerPid: 9003,
                    ownerStartTime: 'Tue Mar 18 15:15:15 2026',
                    createdAtMs: 789,
                }),
                'utf8',
            );

            const terminateProcessTreeByPid = vi.fn(async () => {});
            const inspectProcess = vi.fn((pid: number) => {
                if (pid === 9003) {
                    return { ok: false as const, reason: 'not_found' as const };
                }
                if (pid === 8125) {
                    return {
                        ok: true as const,
                        command: 'node /tmp/fake-worker.js --label generic-worker',
                        startTime: 'Tue Mar 18 16:16:16 2026',
                    };
                }
                return { ok: false as const, reason: 'inspect_failed' as const };
            });

            await sweepProcessOwnershipLeases({
                rootDir,
                leaseKind: 'generic-worker',
                currentOwnerPid: 1337,
                currentOwnerStartTime: 'Tue Mar 18 17:17:17 2026',
                inspectProcess,
                terminateProcessTreeByPid,
                isOwnedProcessCommand: (command) => command.includes('generic-worker'),
            });

            expect(terminateProcessTreeByPid).not.toHaveBeenCalled();
            expect(await readFile(markerPath, 'utf8')).toContain('"childPid":8125');
        } finally {
            await rm(rootDir, { recursive: true, force: true });
        }
    });
});

// Real temporary markers and the real terminator; only OS boundaries are faked.
it.each(['failed-stop', 'active-owner', 'reused-child', 'owner-inspection-failed', 'unrelated-command'] as const)(
  'preserves the marker and ownership safety for %s', async scenario => {
    const rootDir = await mkdtemp(join(tmpdir(), 'happier-lease-retry-'));
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux');
    const start = 'Tue Mar 18 10:10:10 2026';
    let stopped = false;
    let allowStop = false;
    const signals: number[] = [];
    vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
      if (stopped) throw Object.assign(new Error('gone'), { code: 'ESRCH' });
      if (signal !== 0) {
        signals.push(pid);
        if (!allowStop) throw Object.assign(new Error('denied'), { code: 'EPERM' });
        stopped = true;
      }
      return true;
    });
    vi.mocked(childProcess.spawnSync).mockImplementation((_command, args) => {
      const argv = args as string[];
      let stdout = '';
      if (!stopped) stdout = argv.includes('-axo')
        ? `8123 1 8123${argv.join().includes('lstart') ? ` ${start} generic-worker` : ''}`
        : argv.includes('stat=') ? 'S' : argv.join().includes('lstart') ? start : 'generic-worker';
      return { pid: 0, output: [null, stdout, null], stdout, stderr: '', status: argv.includes('-axo') || stdout ? 0 : 1, signal: null };
    });
    try {
      const leaseDir = resolveProcessOwnershipLeasesDir({ rootDir, leaseKind: 'generic-worker' });
      await mkdir(leaseDir, { recursive: true });
      const path = join(leaseDir, 'pid-8123.json');
      const marker = JSON.stringify({ childPid: 8123, childStartTime: start, ownerPid: 9001, ownerStartTime: start, createdAtMs: 123 });
      await writeFile(path, marker);
      const inspectProcess = (pid: number) => {
        if (pid === 9001) return scenario === 'active-owner'
          ? { ok: true as const, command: 'active-owner', startTime: start }
          : { ok: false as const, reason: scenario === 'owner-inspection-failed' ? 'inspect_failed' as const : 'not_found' as const };
        return { ok: true as const, command: scenario === 'unrelated-command' ? 'unrelated' : 'generic-worker', startTime: scenario === 'reused-child' ? 'different' : start };
      };
      const sweep = () => sweepProcessOwnershipLeases({ rootDir, leaseKind: 'generic-worker', currentOwnerPid: 1337,
        currentOwnerStartTime: 'current-owner', inspectProcess, isOwnedProcessCommand: command => command === 'generic-worker' });
      if (scenario === 'failed-stop' || scenario === 'owner-inspection-failed') {
        await expect(sweep()).rejects.toThrow();
      } else await sweep();
      expect(await readFile(path, 'utf8')).toBe(marker);
      if (scenario === 'failed-stop') {
        allowStop = true;
        await sweep();
        await expect(readFile(path, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
      } else expect(signals).toEqual([]);
    } finally {
      vi.useRealTimers();
      await rm(rootDir, { recursive: true, force: true });
    }
  },
);
