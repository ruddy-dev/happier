import * as childProcess from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { terminateProcessTreeByPid } from './processTree';

vi.mock('node:child_process', () => ({ spawnSync: vi.fn() }));

// All PIDs and OS responses are synthetic. No signal reaches a host process.
describe('owned process termination confirmation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(childProcess.spawnSync).mockReturnValue({
      pid: 0, output: [null, '', null], stdout: '', stderr: '', status: 0, signal: null,
    });
  });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it.each(['linux', 'win32'] as const)('rejects a final termination timeout on %s even with an empty process listing', async platform => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue(platform);
    vi.spyOn(process, 'kill').mockImplementation(() => true);
    const result = terminateProcessTreeByPid(8123, { graceMs: 100, pollMs: 25, skipAliveCheck: true });
    const assertion = expect(result).rejects.toThrow(/terminat/i);
    await vi.runAllTimersAsync();
    await assertion;
  });

  it.each(['linux', 'win32'] as const)('waits for the owned root and additional target to exit on %s', async platform => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue(platform);
    const alive = new Set([8123, 8124]);
    vi.spyOn(process, 'kill').mockImplementation(pid => {
      if (!alive.has(Math.abs(pid))) throw Object.assign(new Error('gone'), { code: 'ESRCH' });
      return true;
    });
    let completed = false;
    const result = terminateProcessTreeByPid(8123, { graceMs: 100, pollMs: 25, additionalPids: [8124] }).then(() => { completed = true; });
    await vi.advanceTimersByTimeAsync(25);
    expect(completed).toBe(false);
    alive.delete(8123);
    await vi.advanceTimersByTimeAsync(25);
    expect(completed).toBe(false);
    alive.delete(8124);
    await vi.runAllTimersAsync();
    await result;
    expect(completed).toBe(true);
  });

  it('retains a discovered descendant after it reparents outside the process group', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux');
    vi.mocked(childProcess.spawnSync).mockReturnValueOnce({
      pid: 0, output: [null, '', null], stdout: '8123 1 8123\n8124 8123 8124\n', stderr: '', status: 0, signal: null,
    });
    vi.spyOn(process, 'kill').mockImplementation(pid => {
      if (pid !== 8124 && pid !== -8124) throw Object.assign(new Error('gone'), { code: 'ESRCH' });
      return true;
    });
    const result = terminateProcessTreeByPid(8123, { graceMs: 100, pollMs: 25, skipAliveCheck: true });
    const assertion = expect(result).rejects.toThrow(/terminat/i);
    await vi.runAllTimersAsync();
    await assertion;
  });

  it('does not certify an unknown target', async () => {
    await expect(terminateProcessTreeByPid(0)).rejects.toThrow();
  });

  it('does not skip an owned group when its root has already exited', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux');
    vi.spyOn(process, 'kill').mockImplementation(pid => {
      if (pid !== -8123) throw Object.assign(new Error('gone'), { code: 'ESRCH' });
      return true;
    });
    const assertion = expect(terminateProcessTreeByPid(8123, { graceMs: 100, pollMs: 25 })).rejects.toThrow(/terminat/i);
    await vi.runAllTimersAsync();
    await assertion;
  });
});
