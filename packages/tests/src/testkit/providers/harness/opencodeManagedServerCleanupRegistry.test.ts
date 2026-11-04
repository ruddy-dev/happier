import * as childProcess from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cleanupRegisteredOpenCodeManagedServerHomesBestEffort,
  registerOpenCodeManagedServerHomeForCleanup,
} from './opencodeManagedServerCleanupRegistry';

vi.mock('node:child_process', () => ({ spawnSync: vi.fn() }));
const command = 'owned-managed-server';
const start = 'Tue Mar 18 10:10:10 2026';
const hash = createHash('sha256').update(command).digest('hex');

describe('opencodeManagedServerCleanupRegistry', () => {
  const homes: string[] = [];
  const unregister: Array<() => void> = [];
  let alive: Set<number>;
  let denied: boolean;
  beforeEach(() => {
    alive = new Set(); denied = false;
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin');
    // Do not install real signal/exit handlers in a synthetic boundary test.
    vi.spyOn(process, 'once').mockReturnValue(process);
    vi.mocked(childProcess.spawnSync).mockImplementation((_command, args) => {
      const argv = args as string[];
      const listing = argv.includes('-axo');
      const pid = Number(argv[argv.indexOf('-p') + 1]);
      const stdout = listing ? [...alive].map(id => `${id} 1 ${id} ${start} ${command}`).join('\n')
        : alive.has(pid) ? argv.includes('stat=') ? 'S' : argv.includes('lstart=') ? start : command : '';
      return { pid: 0, output: [null, stdout, null], stdout, stderr: '', status: listing || alive.has(pid) ? 0 : 1, signal: null };
    });
    vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
      if (!alive.has(Math.abs(pid))) throw Object.assign(new Error('gone'), { code: 'ESRCH' });
      if (signal !== 0) {
        if (denied) throw Object.assign(new Error('denied'), { code: 'EPERM' });
        alive.delete(pid);
      }
      return true;
    });
  });
  afterEach(async () => {
    for (const remove of unregister.splice(0)) remove();
    for (const home of homes.splice(0)) await rm(home, { recursive: true, force: true });
    vi.restoreAllMocks();
  });
  async function fixture(pid: number) {
    const home = await mkdtemp(join(tmpdir(), 'happier-opencode-cleanup-'));
    homes.push(home); alive.add(pid);
    await mkdir(join(home, 'opencode'));
    const path = join(home, 'opencode', 'managed-server.json');
    const raw = JSON.stringify({ pid, baseUrl: 'http://127.0.0.1:1', startedAtMs: 1,
      expectedCmdlineHash: hash, processInstanceFingerprint: `darwin-ps:${start}` });
    await writeFile(path, raw);
    await writeFile(`${path}.lock`, 'writer-lock');
    return { home, path, raw };
  }
  it('only cleans up registered homes', async () => {
    const owned = await fixture(8123);
    const unowned = await fixture(8124);
    unregister.push(registerOpenCodeManagedServerHomeForCleanup(owned.home));
    await cleanupRegisteredOpenCodeManagedServerHomesBestEffort();
    expect(alive).toEqual(new Set([8124]));
    await expect(readFile(owned.path)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(unowned.path, 'utf8')).toBe(unowned.raw);
    expect(await readFile(`${owned.path}.lock`, 'utf8')).toBe('writer-lock');
  });
  it('does not clean up an unregistered home', async () => {
    const owned = await fixture(8123);
    registerOpenCodeManagedServerHomeForCleanup(owned.home)();
    await cleanupRegisteredOpenCodeManagedServerHomesBestEffort();
    expect(alive).toEqual(new Set([8123]));
  });
  it('reports a refused stop and retains registration and files for retry', async () => {
    const owned = await fixture(8123);
    unregister.push(registerOpenCodeManagedServerHomeForCleanup(owned.home));
    denied = true;
    await expect(cleanupRegisteredOpenCodeManagedServerHomesBestEffort()).rejects.toThrow(/cleanup/i);
    expect(await readFile(owned.path, 'utf8')).toBe(owned.raw);
    expect(await readFile(`${owned.path}.lock`, 'utf8')).toBe('writer-lock');
    denied = false;
    await cleanupRegisteredOpenCodeManagedServerHomesBestEffort();
    expect(alive.size).toBe(0);
    await expect(readFile(owned.path)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
