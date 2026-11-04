import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { processInstanceFingerprintMatches, readProcessInstanceFingerprintSync } from '@happier-dev/cli-common/processInstance';
import { inspectOwnedProcess, type ProcessInspectionResult } from './processIdentity';

type ProcessIdentity = Pick<Extract<ProcessInspectionResult, { ok: true }>, 'command' | 'startTime'> & {
  processInstanceFingerprint?: string;
};
type ProcessEntry = ProcessIdentity & { pid: number; ppid: number; pgid: number };

export type ProcessTreeOwnership = {
  rootPid: number;
  processes: Map<number, ProcessIdentity>;
  // Groups are confirmation checks only. A numeric group id never grants signal authority.
  groups: Set<number>;
  inspectionError?: Error;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code !== 'ESRCH'; }
}

function listUnixProcesses(): ProcessEntry[] {
  const result = spawnSync('ps', ['-axo', 'pid=,ppid=,pgid=,lstart=,args=', '-ww'], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
  });
  if (result.error || result.status !== 0 || typeof result.stdout !== 'string') {
    throw new Error('Owned process termination was not confirmed: process inspection failed');
  }
  return result.stdout.split('\n').filter(line => line.trim()).map(line => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(\S+\s+\S+\s+\d+\s+\S+\s+\d+)\s+(.+)$/);
    if (!match) throw new Error('Owned process termination was not confirmed: malformed process inspection');
    return { pid: Number(match[1]), ppid: Number(match[2]), pgid: Number(match[3]), startTime: match[4].replace(/\s+/g, ' '), command: match[5].trim() };
  });
}

// Observational API for callers that display/wait on descendants. These numbers
// confer no termination authority; cleanup uses captured identities below.
export function collectDescendantPids(rootPid: number): number[] {
  if (process.platform === 'win32' || !Number.isInteger(rootPid) || rootPid <= 1) return [];
  const snapshot = listUnixProcesses();
  const descendants = new Set<number>();
  const queue = [rootPid];
  while (queue.length) {
    const parent = queue.shift()!;
    for (const entry of snapshot) {
      if (entry.ppid !== parent || entry.pid === rootPid || descendants.has(entry.pid)) continue;
      descendants.add(entry.pid);
      queue.push(entry.pid);
    }
  }
  return [...descendants];
}

function sameIdentity(left: ProcessIdentity, right: ProcessIdentity): boolean {
  return left.startTime.replace(/\s+/g, ' ') === right.startTime.replace(/\s+/g, ' ') && left.command === right.command;
}

// Call only when ownership is established (spawn or a validated persisted lease),
// never to recover authority from a remembered numeric PID at stop time.
export function captureProcessTreeOwnership(pid: number, identity?: ProcessIdentity): ProcessTreeOwnership {
  const ownership: ProcessTreeOwnership = { rootPid: pid, processes: new Map(), groups: new Set() };
  if (process.platform === 'win32') {
    ownership.inspectionError = new Error('Owned process identity inspection is unsupported on Windows; refusing taskkill');
    return ownership;
  }
  if (identity) {
    ownership.processes.set(pid, identity);
  } else {
    const initial = inspectOwnedProcess(pid);
    if (initial.ok) ownership.processes.set(pid, initial);
    else ownership.inspectionError = new Error('Owned process termination was not confirmed: initial identity unavailable');
  }
  return ownership;
}

// Existing product markers may contain the canonical cli-common birth proof.
// Legacy timestamps and command hashes alone cannot establish ownership.
export function capturePersistedProcessTreeOwnership(pid: number, record: {
  processInstanceFingerprint?: string;
  commandHash?: string;
}): ProcessTreeOwnership {
  const fingerprint = record.processInstanceFingerprint?.trim();
  if (!fingerprint || !record.commandHash) {
    throw new Error(`Cannot establish process ownership for ${pid}: persisted birth identity and command hash required`);
  }
  const matches = () => processInstanceFingerprintMatches(fingerprint,
    readProcessInstanceFingerprintSync(pid, { spawnSyncImpl: spawnSync }));
  if (!matches()) throw new Error(`Cannot establish process ownership for ${pid}: birth identity unavailable or changed`);
  const inspected = inspectOwnedProcess(pid);
  if (!inspected.ok || createHash('sha256').update(inspected.command).digest('hex') !== record.commandHash || !matches()) {
    throw new Error(`Cannot establish process ownership for ${pid}: command or birth identity inspection failed`);
  }
  return captureProcessTreeOwnership(pid, { ...inspected, processInstanceFingerprint: fingerprint });
}

function matchesPersistedFingerprint(pid: number, expected: ProcessIdentity): boolean {
  return !expected.processInstanceFingerprint || processInstanceFingerprintMatches(expected.processInstanceFingerprint,
    readProcessInstanceFingerprintSync(pid, { spawnSyncImpl: spawnSync }));
}

export function observeOwnedProcessTree(ownership: ProcessTreeOwnership): void {
  if (ownership.inspectionError) return;
  try {
    const snapshot = listUnixProcesses();
    const byPid = new Map(snapshot.map(entry => [entry.pid, entry]));
    const queue = [...ownership.processes.keys()];
    const visited = new Set<number>();
    while (queue.length) {
      const pid = queue.shift()!;
      if (visited.has(pid)) continue;
      visited.add(pid);
      const expected = ownership.processes.get(pid)!;
      const current = byPid.get(pid);
      // Never use a replaced/exited root as authority for new descendants.
      if (!current || !sameIdentity(expected, current) || !matchesPersistedFingerprint(pid, expected)) continue;
      if (current.pgid === pid) ownership.groups.add(pid);
      for (const child of snapshot) {
        if (child.ppid !== pid || ownership.processes.has(child.pid)) continue;
        ownership.processes.set(child.pid, { command: child.command, startTime: child.startTime });
        queue.push(child.pid);
      }
    }
  } catch (error) {
    // A missed observation can conceal a detached child after reparenting.
    ownership.inspectionError = error instanceof Error ? error : new Error(String(error));
  }
}

function inspectTarget(pid: number, expected: ProcessIdentity): boolean {
  const current = inspectOwnedProcess(pid);
  if (!current.ok) {
    if (current.reason === 'not_found') return false;
    throw new Error(`Owned process termination was not confirmed: cannot inspect identity for ${pid}`);
  }
  if (current.startTime.replace(/\s+/g, ' ') !== expected.startTime.replace(/\s+/g, ' ')) return false;
  if (!sameIdentity(expected, current)) {
    throw new Error(`Owned process termination was not confirmed: command identity changed for ${pid}`);
  }
  if (!matchesPersistedFingerprint(pid, expected)) {
    throw new Error(`Owned process termination was not confirmed: birth identity changed or unavailable for ${pid}`);
  }
  return true;
}

function signalTargets(ownership: ProcessTreeOwnership, signal: NodeJS.Signals): void {
  // Children first. No negative PID or taskkill /T can expand this checked set.
  for (const [pid, identity] of [...ownership.processes].reverse()) {
    if (!inspectTarget(pid, identity)) continue;
    try { process.kill(pid, signal); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') {
        throw new Error(`Owned process termination was not confirmed: signal failed for ${pid}`, { cause: error });
      }
    }
  }
}

function allTargetsStopped(ownership: ProcessTreeOwnership): boolean {
  for (const [pid, identity] of ownership.processes) if (inspectTarget(pid, identity)) return false;
  // An unobserved orphan or reused group is unresolved, never a signal target.
  for (const group of ownership.groups) {
    try { process.kill(-group, 0); return false; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') return false; }
  }
  return true;
}

export async function terminateProcessTreeByPid(
  pid: number,
  options: { graceMs?: number; pollMs?: number; skipAliveCheck?: boolean; additionalPids?: number[]; ownership: ProcessTreeOwnership; signal?: NodeJS.Signals; descendants?: boolean },
): Promise<void> {
  if (!Number.isInteger(pid) || pid <= 1) throw new Error('Cannot confirm termination without an owned process id');
  if (process.platform === 'win32') throw new Error('Owned process identity inspection is unsupported on Windows; refusing taskkill');
  let ownership = options.ownership;
  if (!ownership || ownership.rootPid !== pid || !ownership.processes.has(pid)) {
    throw new Error('Owned process termination was not confirmed: captured identity required');
  }
  if (options.additionalPids?.some(extra => !ownership.processes.has(extra))) {
    throw new Error('Owned process termination was not confirmed: additional PID identity unavailable');
  }
  // Daemon replacement explicitly keeps sessions alive. Reuse the captured
  // root proof, but neither discover nor signal its descendants in that flow.
  if (options.descendants === false) {
    ownership = { rootPid: pid, processes: new Map([[pid, ownership.processes.get(pid)!]]), groups: new Set() };
  }
  const graceMs = Number.isInteger(options.graceMs) && options.graceMs! >= 0 ? options.graceMs! : 10_000;
  const pollMs = Number.isInteger(options.pollMs) && options.pollMs! > 0 ? options.pollMs! : 100;
  const observe = () => {
    if (options.descendants !== false) observeOwnedProcessTree(ownership);
    if (ownership.inspectionError) throw ownership.inspectionError;
  };
  observe();
  signalTargets(ownership, options.signal ?? 'SIGTERM');
  const startedAt = Date.now();
  while (Date.now() - startedAt < graceMs) {
    observe();
    if (allTargetsStopped(ownership)) return;
    await sleep(pollMs);
  }
  observe();
  signalTargets(ownership, 'SIGKILL');
  const killDeadline = Date.now() + Math.max(250, pollMs * 4);
  while (Date.now() < killDeadline) {
    observe();
    if (allTargetsStopped(ownership)) return;
    await sleep(pollMs);
  }
  if (!allTargetsStopped(ownership)) throw new Error('Owned process termination was not confirmed');
}
