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

function listProcesses(): ProcessEntry[] {
  if (process.platform !== 'win32') return listUnixProcesses();
  // Snapshot parentage and birth together. CreationDate encoding matches the
  // cli-common processInstance contract; individual checks still use that owner.
  const script = [
    '$rows = @(Get-CimInstance Win32_Process -ErrorAction Stop | ForEach-Object {',
    '[pscustomobject]@{ pid = [int]$_.ProcessId; ppid = [int]$_.ParentProcessId;',
    'startTime = if ($null -ne $_.CreationDate) { "win32-cim:" + $_.CreationDate.ToUniversalTime().ToString("O") } else { "" };',
    'command = $_.CommandLine } });',
    'ConvertTo-Json -InputObject $rows -Compress',
  ].join(' ');
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'],
  });
  if (result.error || result.status !== 0) throw new Error('Owned process termination was not confirmed: CIM inspection failed');
  const rows: unknown = JSON.parse(String(result.stdout));
  if (!Array.isArray(rows)) throw new Error('Owned process termination was not confirmed: malformed CIM inspection');
  return rows.map((value: unknown) => {
    if (!value || typeof value !== 'object') throw new Error('Malformed CIM process identity');
    const row = value as Record<string, unknown>;
    if (!Number.isInteger(row.pid) || !Number.isInteger(row.ppid) || typeof row.startTime !== 'string'
      || (row.command !== null && typeof row.command !== 'string')) throw new Error('Malformed CIM process identity');
    return { pid: row.pid as number, ppid: row.ppid as number, pgid: 0,
      startTime: row.startTime, command: (row.command ?? '').trim() };
  });
}

// Observational API for callers that display/wait on descendants. These numbers
// confer no termination authority; cleanup uses captured identities below.
export function collectDescendantPids(rootPid: number): number[] {
  if (!Number.isInteger(rootPid) || rootPid <= 1) return [];
  const snapshot = listProcesses();
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
}): ProcessTreeOwnership | null {
  const fingerprint = record.processInstanceFingerprint?.trim();
  if (!fingerprint || !record.commandHash) {
    throw new Error(`Cannot establish process ownership for ${pid}: persisted birth identity and command hash required`);
  }
  const matches = () => processInstanceFingerprintMatches(fingerprint,
    readProcessInstanceFingerprintSync(pid, { spawnSyncImpl: spawnSync }));
  const before = matches();
  const inspected = inspectOwnedProcess(pid);
  // A null fingerprint also means probe failure. Only positive OS absence can
  // retire an unchanged persisted marker without obtaining signal authority.
  if (!inspected.ok && inspected.reason === 'not_found') return null;
  if (!before) throw new Error(`Cannot establish process ownership for ${pid}: birth identity unavailable or changed`);
  if (!inspected.ok || (!inspected.state?.startsWith('Z') && createHash('sha256').update(inspected.command).digest('hex') !== record.commandHash) || !matches()) {
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
    const snapshot = listProcesses();
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
        if (child.pid <= 1 || child.ppid !== pid || ownership.processes.has(child.pid)) continue;
        if (process.platform === 'win32') {
          // Windows retains the creator PID after it exits. A younger process
          // reusing that PID cannot own the older child. Compare full UTC/O
          // precision rather than truncating birth times to JS milliseconds.
          const birthFormat = /^win32-cim:\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{7}Z$/;
          if (!birthFormat.test(child.startTime) || !birthFormat.test(current.startTime)) {
            throw new Error('Owned process termination was not confirmed: malformed CIM birth identity');
          }
          if (child.startTime < current.startTime) continue;
        }
        // Incomplete evidence cannot grant signal authority or prove the tree
        // stopped. Keep the observation unresolved even if the parent exits.
        if (!child.command || !child.startTime) {
          throw new Error(`Owned process termination was not confirmed: child identity unavailable for ${child.pid}`);
        }
        ownership.processes.set(child.pid, { command: child.command, startTime: child.startTime,
          ...(process.platform === 'win32' ? { processInstanceFingerprint: child.startTime } : {}) });
        queue.push(child.pid);
      }
    }
  } catch (error) {
    // A missed observation can conceal a detached child after reparenting.
    ownership.inspectionError = error instanceof Error ? error : new Error(String(error));
  }
}

function inspectTarget(pid: number, expected: ProcessIdentity): 'live' | 'stopped' | 'absent' | 'replaced' {
  const current = inspectOwnedProcess(pid);
  if (!current.ok) {
    if (current.reason === 'not_found') return 'absent';
    throw new Error(`Owned process termination was not confirmed: cannot inspect identity for ${pid}`);
  }
  if (current.startTime.replace(/\s+/g, ' ') !== expected.startTime.replace(/\s+/g, ' ')) return 'replaced';
  if (!matchesPersistedFingerprint(pid, expected)) {
    throw new Error(`Owned process termination was not confirmed: birth identity changed or unavailable for ${pid}`);
  }
  // Only an observed kernel zombie state with matching captured birth proof can
  // bypass command comparison. A stopped/suspended live process still needs stop.
  if (current.state?.startsWith('Z')) return 'stopped';
  if (!sameIdentity(expected, current)) {
    throw new Error(`Owned process termination was not confirmed: command identity changed for ${pid}`);
  }
  return 'live';
}

function signalTargets(ownership: ProcessTreeOwnership, signal: NodeJS.Signals, errors: Map<number, unknown>): void {
  // Children first. No negative PID or taskkill /T can expand this checked set.
  for (const [pid, identity] of [...ownership.processes].reverse()) {
    try {
      if (inspectTarget(pid, identity) !== 'live') continue;
      try { process.kill(pid, signal); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') {
          throw new Error(`Owned process termination was not confirmed: signal failed for ${pid}`, { cause: error });
        }
      }
    } catch (error) { if (!errors.has(pid)) errors.set(pid, error); }
  }
}

function allTargetsStopped(ownership: ProcessTreeOwnership, errors: Map<number, unknown>): boolean {
  let stopped = true;
  for (const [pid, identity] of ownership.processes) {
    try {
      const state = inspectTarget(pid, identity);
      if (state === 'live' || state === 'replaced') stopped = false;
    } catch (error) { if (!errors.has(pid)) errors.set(pid, error); stopped = false; }
  }
  if (!stopped) return false;
  // A group containing only positively owned zombies is stopped. Unknown,
  // replaced or unreadable members keep confirmation unresolved.
  for (const group of ownership.groups) {
    try { process.kill(-group, 0); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') continue;
      errors.set(-group, error);
      return false;
    }
    const members = listProcesses().filter(entry => entry.pgid === group);
    if (!members.length) return false;
    for (const member of members) {
      const expected = ownership.processes.get(member.pid);
      if (!expected) return false;
      try { if (inspectTarget(member.pid, expected) !== 'stopped') return false; }
      catch (error) { errors.set(member.pid, error); return false; }
    }
  }
  return true;
}

export async function terminateProcessTreeByPid(
  pid: number,
  options: { graceMs?: number; pollMs?: number; skipAliveCheck?: boolean; additionalPids?: number[]; ownership: ProcessTreeOwnership; signal?: NodeJS.Signals; descendants?: boolean },
): Promise<void> {
  if (!Number.isInteger(pid) || pid <= 1) throw new Error('Cannot confirm termination without an owned process id');
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
    ownership = { ...ownership, processes: new Map([[pid, ownership.processes.get(pid)!]]), groups: new Set() };
  }
  const graceMs = Number.isInteger(options.graceMs) && options.graceMs! >= 0 ? options.graceMs! : 10_000;
  const pollMs = Number.isInteger(options.pollMs) && options.pollMs! > 0 ? options.pollMs! : 100;
  const observe = () => {
    if (options.descendants !== false) observeOwnedProcessTree(ownership);
    if (ownership.inspectionError) throw ownership.inspectionError;
  };
  const errors = new Map<number, unknown>();
  const confirm = () => {
    if (!allTargetsStopped(ownership, errors)) return false;
    if (errors.size) throwCleanupErrors();
    return true;
  };
  const throwCleanupErrors = () => {
    const details = [...errors.values()];
    throw new AggregateError(details, `Owned process termination was not confirmed: ${details.map(String).join('; ')}`);
  };
  observe();
  signalTargets(ownership, options.signal ?? 'SIGTERM', errors);
  const startedAt = Date.now();
  while (Date.now() - startedAt < graceMs) {
    observe();
    if (confirm()) return;
    if (errors.size) break;
    await sleep(pollMs);
  }
  observe();
  signalTargets(ownership, 'SIGKILL', errors);
  const killDeadline = Date.now() + Math.max(250, pollMs * 4);
  while (Date.now() < killDeadline) {
    observe();
    if (confirm()) return;
    if (errors.size) break;
    await sleep(pollMs);
  }
  if (!confirm()) throwCleanupErrors();
}
