import * as childProcess from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { captureProcessTreeOwnership, observeOwnedProcessTree, terminateProcessTreeByPid } from './processTree';

vi.mock('node:child_process', () => ({ spawnSync: vi.fn() }));

type Row = { parent: number; group: number; start: string; command: string };
const start = 'Tue Mar 18 10:10:10 2026';
const row = (parent: number, group: number): Row => ({ parent, group, start, command: `worker-${group}` });
let rows: Map<number, Row>;
let signals: number[];
let signalStops: boolean;
let inspectionFails: boolean;
// All PIDs, listings and signals are synthetic OS boundaries.
beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(process, 'platform', 'get').mockReturnValue('linux');
  rows = new Map([[8123, row(1, 8123)], [8124, row(8123, 8124)]]);
  signals = []; signalStops = true; inspectionFails = false;
  vi.mocked(childProcess.spawnSync).mockImplementation((_command, args) => {
    const argv = args as string[];
    const current = rows.get(Number(argv[argv.indexOf('-p') + 1]));
    const stdout = inspectionFails ? '' : argv.includes('-axo')
      ? [...rows].map(([pid, entry]) => `${pid} ${entry.parent} ${entry.group} ${entry.start} ${entry.command}`).join('\n')
      : current ? argv.join().includes('lstart') ? current.start : current.command : '';
    return { pid: 0, output: [null, stdout, null], stdout, stderr: '', status: inspectionFails ? 2 : argv.includes('-axo') || current ? 0 : 1, signal: null };
  });
  vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
    const exists = pid < 0 ? [...rows.values()].some(entry => entry.group === -pid) : rows.has(pid);
    if (!exists) throw Object.assign(new Error('gone'), { code: 'ESRCH' });
    if (signal !== 0) {
      signals.push(pid);
      if (signalStops) rows.delete(pid);
    }
    return true;
  });
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

function capture() {
  const ownership = captureProcessTreeOwnership(8123);
  observeOwnedProcessTree(ownership);
  return ownership;
}
async function settle(result: Promise<void>) {
  const assertion = expect(result).resolves.toBeUndefined();
  await vi.runAllTimersAsync();
  await assertion;
}
async function rejects(result: Promise<void>) {
  const assertion = expect(result).rejects.toThrow(/identity|inspection|terminat/i);
  await vi.runAllTimersAsync();
  await assertion;
}

describe('owned process termination', () => {
  it('stops only the captured root when replacing a daemon without stopping sessions', async () => {
    const ownership = capture();
    await settle(terminateProcessTreeByPid(8123, { ownership, graceMs: 0, descendants: false }));
    expect(signals).toEqual([8123]);
    expect([...rows.keys()]).toEqual([8124]);
  });

  it('stops an observed detached descendant after root exit and reparenting', async () => {
    const ownership = capture();
    rows.delete(8123); rows.get(8124)!.parent = 1;
    await settle(terminateProcessTreeByPid(8123, { ownership, graceMs: 100, pollMs: 25 }));
    expect(signals).toEqual([8124]);
    expect(rows.size).toBe(0);
  });

  it.each([8123, 8124])('does not discover or signal replacements under recycled PID %s', async pid => {
    const ownership = capture();
    rows.set(pid, { ...row(1, pid), start: 'Tue Mar 18 11:11:11 2026', command: 'unrelated' });
    rows.set(8125, row(pid, pid));
    await rejects(terminateProcessTreeByPid(8123, { ownership, graceMs: 0, pollMs: 25 }));
    expect(signals).not.toContain(pid);
    expect(signals).not.toContain(-pid);
    expect(signals).not.toContain(8125);
  });

  it('checks identity again at each signal, including escalation after PID reuse', async () => {
    const ownership = capture();
    signalStops = false;
    const result = terminateProcessTreeByPid(8123, { ownership, graceMs: 100, pollMs: 25 });
    const assertion = expect(result).rejects.toThrow(/terminat/i);
    signals.length = 0;
    rows.set(8124, { ...row(1, 8124), start: 'Tue Mar 18 11:11:11 2026' });
    await vi.runAllTimersAsync();
    await assertion;
    expect(signals).not.toContain(8124);
  });

  it('revalidates identity after discovery immediately before signalling', async () => {
    const ownership = capture();
    const inspect = vi.mocked(childProcess.spawnSync).getMockImplementation()!;
    vi.mocked(childProcess.spawnSync).mockImplementation((command, args, options) => {
      if (args?.includes('args=') && args.includes('8124')) {
        rows.set(8124, { ...row(1, 8124), start: 'Tue Mar 18 11:11:11 2026', command: 'replacement' });
      }
      return inspect(command, args, options);
    });
    await rejects(terminateProcessTreeByPid(8123, { ownership, graceMs: 0, pollMs: 25 }));
    expect(signals).not.toContain(8124);
    expect(signals).not.toContain(-8124);
    expect(rows.get(8124)?.command).toBe('replacement');
  });

  it('does not turn a reused or unobserved group into signal authority', async () => {
    const ownership = capture();
    rows.clear(); rows.set(8125, row(1, 8123));
    await rejects(terminateProcessTreeByPid(8123, { ownership, graceMs: 0, pollMs: 25 }));
    expect(signals).toEqual([]);
  });

  it('rejects unavailable inspection without signalling anything', async () => {
    const ownership = capture();
    inspectionFails = true;
    await rejects(terminateProcessTreeByPid(8123, { ownership, graceMs: 0 }));
    expect(signals).toEqual([]);
  });

  it('does not reconstruct ownership from bare root/additional PIDs', async () => {
    // @ts-expect-error Exercise the runtime boundary against a caller without captured authority.
    await rejects(terminateProcessTreeByPid(8123, { additionalPids: [8124] }));
    expect(signals).toEqual([]);
  });

  it('rejects command identity changes rather than certifying an exec as stopped', async () => {
    const ownership = capture(); rows.get(8124)!.command = 'changed-command';
    await rejects(terminateProcessTreeByPid(8123, { ownership, graceMs: 0 }));
    expect(signals).toEqual([]);
  });

  it('discovers a new child of a still-owned detached descendant', async () => {
    const ownership = capture(); rows.delete(8123); rows.get(8124)!.parent = 1;
    rows.set(8125, row(8124, 8124));
    rows.set(9000, row(1, 9000));
    await settle(terminateProcessTreeByPid(8123, { ownership, graceMs: 100, pollMs: 25 }));
    expect(signals).toEqual([8125, 8124]);
    expect([...rows.keys()]).toEqual([9000]);
  });

  it('rejects a final termination timeout while any known target survives', async () => {
    const ownership = capture(); signalStops = false;
    await rejects(terminateProcessTreeByPid(8123, { ownership, graceMs: 100, pollMs: 25 }));
  });

  it('refuses Windows tree termination without an identity-capable OS owner', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
    await rejects(terminateProcessTreeByPid(8123, { ownership: captureProcessTreeOwnership(8123) }));
    expect(childProcess.spawnSync).not.toHaveBeenCalled();
    expect(process.kill).not.toHaveBeenCalled();
  });
});
