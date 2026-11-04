import * as childProcess from 'node:child_process';
import { ChildProcess } from 'node:child_process';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { runLoggedCommand, spawnLoggedProcess } from './spawnProcess';

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
  vi.mocked(childProcess.spawnSync).mockReturnValue({ pid: 0, output: [null, '', null], stdout: '', stderr: '', status: 0, signal: null });
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
