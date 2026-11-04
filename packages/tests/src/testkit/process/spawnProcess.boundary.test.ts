import * as childProcess from 'node:child_process';
import { ChildProcess } from 'node:child_process';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { runLoggedCommand, spawnLoggedProcess } from './spawnProcess';
import { observeOwnedProcessTree } from './processTree';
import { spawnTestProcess } from './testSpawn';

// OS and log-stream boundaries only; no host child, signal or file is created.
vi.mock('node:child_process', async importOriginal => ({
  ...await importOriginal<typeof childProcess>(), spawn: vi.fn(), spawnSync: vi.fn(),
}));
vi.mock('node:fs', () => ({ createWriteStream: () => new PassThrough() }));

class BoundaryChild extends ChildProcess {
  override pid: number | undefined = 8123;
  override exitCode: number | null = null;
}
let child: BoundaryChild;
const params = { command: 'synthetic', args: [], cwd: '.', stdoutPath: 'out.log', stderrPath: 'err.log' };
beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(process, 'platform', 'get').mockReturnValue('linux');
  child = new BoundaryChild();
  child.stdout = new PassThrough(); child.stderr = new PassThrough();
  vi.mocked(childProcess.spawn).mockReturnValue(child);
  vi.mocked(childProcess.spawnSync).mockImplementation((_command, args) => {
    const argv = args as string[];
    const stdout = child.exitCode !== null ? '' : argv.includes('-axo')
      ? '8123 1 8123 Tue Mar 18 10:10:10 2026 synthetic'
      : argv.join().includes('lstart') ? 'Tue Mar 18 10:10:10 2026' : 'synthetic';
    return { pid: 0, output: [null, stdout, null], stdout, stderr: '', status: argv.includes('-axo') || stdout ? 0 : 1, signal: null };
  });
  vi.spyOn(process, 'kill').mockImplementation(() => true);
});
afterEach(() => {
  child.emit('exit', 0, null);
  child.stdout?.destroy(); child.stderr?.destroy();
  vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks();
});

it('does not certify stop without an owned PID', async () => {
  child.pid = undefined;
  vi.spyOn(child, 'kill').mockReturnValue(false);
  await expect(spawnLoggedProcess(params).stop()).rejects.toThrow(/owned process id/);
});

it.each([true, false])('reports a command timeout together with unconfirmed termination, logs drained: %s', async drained => {
  const result = runLoggedCommand({ ...params, timeoutMs: 50 });
  // Log completion cannot stand in for process termination.
  if (drained) { child.stdout?.emit('end'); child.stderr?.emit('end'); }
  const assertion = expect(result).rejects.toMatchObject({ cause: expect.objectContaining({
    errors: [expect.objectContaining({ message: expect.stringContaining('timed out') }),
      expect.objectContaining({ message: expect.stringContaining('termination was not confirmed') })],
  }) });
  await vi.runAllTimersAsync();
  await assertion;
});

it('preserves the command timeout when termination succeeds during exit', async () => {
  vi.mocked(process.kill).mockImplementation(() => {
    child.exitCode = 0;
    child.emit('exit', 0, null);
    throw Object.assign(new Error('gone'), { code: 'ESRCH' });
  });
  const result = runLoggedCommand({ ...params, timeoutMs: 50 });
  child.stdout?.emit('end'); child.stderr?.emit('end');
  const assertion = expect(result).rejects.toMatchObject({ cause: expect.objectContaining({ message: expect.stringContaining('timed out after 50ms') }) });
  await vi.runAllTimersAsync();
  await assertion;
});

it('preserves successful command completion', async () => {
  const result = runLoggedCommand(params);
  child.stdout?.emit('end'); child.stderr?.emit('end');
  child.exitCode = 0; child.emit('exit', 0, null);
  await expect(result).resolves.toBeUndefined();
});

it('carries spawn-time ownership into test-child cleanup and refuses a changed command', async () => {
  const owned = spawnTestProcess('synthetic');
  expect(owned.ownership?.processes.get(8123)?.command).toBe('synthetic');
  const inspect = vi.mocked(childProcess.spawnSync).getMockImplementation()!;
  vi.mocked(childProcess.spawnSync).mockImplementation((command, args, options) => {
    const result = inspect(command, args, options);
    if (args?.includes('args=')) return { ...result, stdout: 'replacement-command' };
    return result;
  });
  await expect(owned.stop()).rejects.toThrow(/command identity/);
  expect(vi.mocked(process.kill).mock.calls.filter(call => call[1] !== 0)).toEqual([]);
});

it('terminates the matching test child using the ownership returned at spawn', async () => {
  const owned = spawnTestProcess('synthetic');
  vi.mocked(process.kill).mockImplementation((_pid, signal) => {
    if (child.exitCode !== null) throw Object.assign(new Error('gone'), { code: 'ESRCH' });
    if (signal !== 0) child.exitCode = 0;
    return true;
  });
  await expect(owned.stop()).resolves.toBeUndefined();
  expect(child.exitCode).toBe(0);
});

// Identity changes happen between observation and stop, as they can over a long
// child lifetime. Every OS operation remains synthetic.
it.each(['descendant', 'root', 'reparented'] as const)('preserves captured ownership for %s cleanup', async recycled => {
  const rows = new Map([
    [8123, { parent: 1, group: 8123, start: 'Tue Mar 18 10:10:10 2026', command: 'synthetic' }],
    [8124, { parent: 8123, group: 8124, start: 'Tue Mar 18 10:10:10 2026', command: 'owned-worker' }],
  ]);
  vi.mocked(childProcess.spawnSync).mockImplementation((_command, args) => {
    const argv = args as string[];
    const row = rows.get(Number(argv[argv.indexOf('-p') + 1]));
    let stdout = '';
    if (argv.includes('-axo')) {
      stdout = [...rows].map(([pid, value]) => `${pid} ${value.parent} ${value.group}` +
        (argv.join().includes('lstart') ? ` ${value.start} ${value.command}` : '')).join('\n');
    } else if (row) {
      stdout = argv.join().includes('lstart') ? row.start : row.command;
    }
    return { pid: 0, output: [null, stdout, null], stdout, stderr: '', status: argv.includes('-axo') || stdout ? 0 : 1, signal: null };
  });
  const signals: number[] = [];
  vi.mocked(process.kill).mockImplementation((pid, signal) => {
    if (signal !== 0) signals.push(pid);
    if (!rows.has(Math.abs(pid))) throw Object.assign(new Error('gone'), { code: 'ESRCH' });
    if (signal !== 0) rows.delete(Math.abs(pid));
    return true;
  });
  if (recycled === 'reparented') {
    const owned = spawnTestProcess('synthetic');
    observeOwnedProcessTree(owned.ownership);
    rows.delete(8123);
    rows.get(8124)!.parent = 1;
    await owned.stop();
    expect(signals).toEqual([8124]);
    expect(rows.size).toBe(0);
    return;
  }
  const proc = spawnLoggedProcess({ ...params, cleanupDescendantsOnExit: false });
  const reusedPid = recycled === 'root' ? 8123 : 8124;
  rows.set(reusedPid, { parent: 1, group: reusedPid, start: 'Tue Mar 18 11:11:11 2026', command: 'unrelated-job' });
  rows.set(8125, { parent: reusedPid, group: reusedPid, start: 'Tue Mar 18 11:11:11 2026', command: 'unrelated-child' });
  // Conservative rejection is allowed; signalling the replacement is not.
  const result = proc.stop('SIGKILL').catch(() => {});
  await vi.runAllTimersAsync();
  await result;
  expect(signals).not.toContain(reusedPid);
  expect(signals).not.toContain(-reusedPid);
  expect(signals).not.toContain(8125);
  expect(rows.has(reusedPid)).toBe(true);
});

it('fails safely on Windows without invoking taskkill against numeric PIDs', async () => {
  vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
  const proc = spawnLoggedProcess(params);
  const result = expect(proc.stop()).rejects.toThrow(/identity|unsupported/i);
  await vi.runAllTimersAsync();
  await result;
  expect(vi.mocked(childProcess.spawnSync).mock.calls.some(call => String(call[1]).includes('taskkill'))).toBe(false);
  expect(process.kill).not.toHaveBeenCalled();
});

it('keeps steady-state tree observation within four snapshots per second', async () => {
  spawnLoggedProcess({ ...params, cleanupDescendantsOnExit: false });
  await vi.advanceTimersByTimeAsync(1_000);
  vi.mocked(childProcess.spawnSync).mockClear();
  await vi.advanceTimersByTimeAsync(1_000);
  const snapshots = vi.mocked(childProcess.spawnSync).mock.calls.filter(call => call[1]?.includes('-axo'));
  expect(snapshots.length).toBeGreaterThan(0);
  expect(snapshots.length).toBeLessThanOrEqual(4);
});

it('does not acquire missing initial identity later from a numeric PID', async () => {
  vi.mocked(childProcess.spawnSync).mockReturnValue({ pid: 0, output: [null, '', null], stdout: '', stderr: '', status: 2, signal: null });
  const proc = spawnLoggedProcess(params);
  await expect(proc.stop()).rejects.toThrow(/identity/);
  expect(vi.mocked(process.kill).mock.calls.filter(call => call[1] !== 0)).toEqual([]);
});
