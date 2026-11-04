import * as childProcess from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { captureProcessTreeOwnership, observeOwnedProcessTree, terminateProcessTreeByPid } from './processTree';

vi.mock('node:child_process', () => ({ spawnSync: vi.fn() }));

type Row = { parent: number; group: number; start: string; command: string | null; state?: string };
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
      : current ? argv.includes('stat=') ? current.state ?? 'S' : argv.join().includes('lstart') ? current.start : current.command ?? '' : '';
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
  await Promise.all([assertion, vi.runAllTimersAsync()]);
}
async function rejects(result: Promise<void>) {
  const assertion = expect(result).rejects.toThrow(/identity|inspection|terminat/i);
  await Promise.all([assertion, vi.runAllTimersAsync()]);
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
    expect(signals).toEqual([8123]);
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

  it('recognizes an owned zombie and still escalates the live root', async () => {
    const ownership = capture();
    const sent: Array<[number, unknown]> = [];
    vi.mocked(process.kill).mockImplementation((pid, signal) => {
      if (signal === 0) {
        if ([...rows].some(([id, r]) => pid === id || -pid === r.group)) return true;
        throw Object.assign(new Error('gone'), { code: 'ESRCH' });
      }
      sent.push([pid, signal]);
      if (pid === 8124) Object.assign(rows.get(pid)!, { state: 'Z', command: '[worker] <defunct>' });
      if (pid === 8123 && signal === 'SIGKILL') rows.delete(pid);
      return true;
    });
    await settle(terminateProcessTreeByPid(8123, { ownership, graceMs: 0 }));
    expect(sent).toEqual([[8124, 'SIGTERM'], [8123, 'SIGTERM'], [8123, 'SIGKILL']]);
    expect(rows.get(8124)?.state).toBe('Z');
  });

  it.each(['unknown-member', 'reused-zombie'] as const)('does not confirm group safety from an owned zombie with %s', async scenario => {
    const ownership = capture();
    rows.delete(8123);
    Object.assign(rows.get(8124)!, { state: 'Z', command: '[worker] <defunct>' });
    if (scenario === 'unknown-member') rows.set(9000, row(1, 8124));
    else rows.get(8124)!.start = 'Tue Mar 18 11:11:11 2026';
    await rejects(terminateProcessTreeByPid(8123, { ownership, graceMs: 0 }));
    expect(signals).toEqual([]);
  });

  it.each(['signal-denied', 'inspection-failed'] as const)('attempts and escalates other owned targets after %s, preserving failure', async scenario => {
    const ownership = capture();
    const inspect = vi.mocked(childProcess.spawnSync).getMockImplementation()!;
    vi.mocked(childProcess.spawnSync).mockImplementation((command, args, options) => {
      if (scenario === 'inspection-failed' && args?.includes('-p') && args.includes('8124')) {
        return { pid: 0, output: [null, '', null], stdout: '', stderr: '', status: 2, signal: null };
      }
      return inspect(command, args, options);
    });
    vi.mocked(process.kill).mockImplementation((pid, signal) => {
      if (!rows.has(Math.abs(pid))) throw Object.assign(new Error('gone'), { code: 'ESRCH' });
      if (signal !== 0) {
        signals.push(pid);
        if (pid === 8124) throw Object.assign(new Error('denied'), { code: 'EPERM' });
        if (signal === 'SIGKILL') rows.delete(pid);
      }
      return true;
    });
    await rejects(terminateProcessTreeByPid(8123, { ownership, graceMs: 0 }));
    expect(signals.filter(pid => pid === 8123)).toEqual([8123, 8123]);
    expect(rows.has(8123)).toBe(false);
    expect(rows.has(8124)).toBe(true);
  });
});

describe('Windows owned process termination at the CIM boundary', () => {
  beforeEach(() => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
    rows.forEach(r => { r.start = '2026-03-18T10:10:10.1234567Z'; });
    vi.mocked(childProcess.spawnSync).mockImplementation((command, args) => {
      expect(command).toBe('powershell.exe');
      const script = String(args?.at(-1));
      const pid = Number(script.match(/ProcessId=(\d+)/)?.[1]);
      const current = rows.get(pid);
      let stdout = '';
      let status = inspectionFails ? 2 : 0;
      if (!inspectionFails) {
        if (script.includes('ProcessId=')) {
          if (!current) status = 3;
          else stdout = script.includes('CommandLine') ? current.command ?? '' : current.start;
        } else stdout = JSON.stringify([...rows].map(([pid, r]) => ({
          pid, ppid: r.parent, startTime: r.start ? `win32-cim:${r.start}` : '', command: r.command,
        })));
      }
      return { pid: 0, output: [null, stdout, null], stdout, stderr: '', status, signal: null };
    });
  });

  it.each([false, true])('stops positively owned root and observed children, root exited: %s', async absent => {
    const ownership = capture();
    if (absent) { rows.delete(8123); rows.get(8124)!.parent = 1; }
    rows.set(9000, row(1, 9000));
    await settle(terminateProcessTreeByPid(8123, { ownership, graceMs: 0 }));
    expect(signals).toEqual(absent ? [8124] : [8124, 8123]);
    expect([...rows.keys()]).toEqual([9000]);
  });

  it('preserves root-only replacement semantics', async () => {
    const ownership = capture();
    await settle(terminateProcessTreeByPid(8123, { ownership, descendants: false, graceMs: 0 }));
    expect(signals).toEqual([8123]);
    expect(rows.has(8124)).toBe(true);
  });

  it.each(['worker-8124', null, ''])('does not adopt an old child whose creator PID was reused by the owned root, command: %s', async command => {
    rows.get(8124)!.start = '2026-03-18T10:10:10.1234566Z';
    rows.get(8124)!.command = command;
    const ownership = capture();
    await settle(terminateProcessTreeByPid(8123, { ownership, graceMs: 0 }));
    expect(signals).toEqual([8123]);
    expect(rows.has(8124)).toBe(true);
  });

  it.each([
    { evidence: 'null command', command: null, start: '2026-03-18T10:10:10.1234568Z' },
    { evidence: 'empty command', command: '', start: '2026-03-18T10:10:10.1234568Z' },
    { evidence: 'blank command', command: '  ', start: '2026-03-18T10:10:10.1234568Z' },
    { evidence: 'missing birth', command: 'worker-8124', start: '' },
  ])('refuses cleanup after root exit when an observed child has $evidence', async ({ command, start }) => {
    Object.assign(rows.get(8124)!, { command, start });
    const ownership = capture();
    expect(ownership.processes.has(8123)).toBe(true);
    expect(ownership.processes.has(8124)).toBe(false);
    // The owned root exits after observation, leaving the unreadable child alive.
    rows.delete(8123);
    await rejects(terminateProcessTreeByPid(8123, { ownership, graceMs: 0 }));
    expect(signals).toEqual([]);
    expect([...rows.keys()]).toEqual([8124]);
    // A later snapshot without the parent must not erase the unresolved observation.
    await rejects(terminateProcessTreeByPid(8123, { ownership, graceMs: 0 }));
    expect(signals).toEqual([]);
    expect(rows.has(8124)).toBe(true);
  });

  it('ignores unreadable protected system rows outside the owned tree', async () => {
    rows.set(9000, { parent: 1, group: 0, start: '', command: null });
    const ownership = capture();
    await settle(terminateProcessTreeByPid(8123, { ownership, graceMs: 0 }));
    expect(signals).toEqual([8124, 8123]);
    expect([...rows.keys()]).toEqual([9000]);
  });

  it.each(['root-reused', 'child-reused', 'command-changed', 'inspection-failed'] as const)('refuses %s without signalling the unrelated process', async scenario => {
    const ownership = capture();
    const changedPid = scenario === 'root-reused' ? 8123 : 8124;
    if (scenario.endsWith('reused')) rows.get(changedPid)!.start = '2026-03-18T10:10:10.7654321Z';
    if (scenario === 'command-changed') rows.get(changedPid)!.command = 'replacement';
    if (scenario === 'inspection-failed') inspectionFails = true;
    rows.set(9000, row(changedPid, 9000));
    await rejects(terminateProcessTreeByPid(8123, { ownership, graceMs: 0 }));
    expect(signals).not.toContain(changedPid);
    expect(signals).not.toContain(9000);
    if (inspectionFails) expect(signals).toEqual([]);
  });
});
