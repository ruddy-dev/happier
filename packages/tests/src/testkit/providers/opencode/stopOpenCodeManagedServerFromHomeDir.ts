import { unlink, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { capturePersistedProcessTreeOwnership, terminateProcessTreeByPid } from '../../process/processTree';

type ManagedServerState = Readonly<{
  baseUrl: string;
  pid: number;
  startedAtMs: number;
  processInstanceFingerprint?: string;
  expectedCmdlineHash?: string;
}>;

function parseState(raw: string): ManagedServerState | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const value = parsed as Record<string, unknown>;
    const baseUrl = typeof value.baseUrl === 'string' ? value.baseUrl.trim() : '';
    const pid = Number(value.pid);
    const startedAtMs = Number(value.startedAtMs);
    if (!baseUrl) return null;
    if (!Number.isInteger(pid) || pid <= 1) return null;
    if (!Number.isFinite(startedAtMs) || startedAtMs <= 0) return null;
    return { baseUrl, pid: Math.trunc(pid), startedAtMs: Math.trunc(startedAtMs),
      processInstanceFingerprint: typeof value.processInstanceFingerprint === 'string' ? value.processInstanceFingerprint : undefined,
      expectedCmdlineHash: typeof value.expectedCmdlineHash === 'string' ? value.expectedCmdlineHash : undefined };
  } catch {
    return null;
  }
}

export async function stopOpenCodeManagedServerFromHomeDir(happyHomeDir: string): Promise<void> {
  const statePath = join(happyHomeDir, 'opencode', 'managed-server.json');

  const raw = await readFile(statePath, 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (raw === null) return;
  const state = parseState(raw);
  if (!state) throw new Error(`Cannot establish managed-server ownership: invalid state at ${statePath}`);

  const ownership = capturePersistedProcessTreeOwnership(state.pid, {
    processInstanceFingerprint: state.processInstanceFingerprint,
    commandHash: state.expectedCmdlineHash,
  });
  await terminateProcessTreeByPid(state.pid, { ownership, graceMs: 5_000, pollMs: 100 });

  if (await readFile(statePath, 'utf8') !== raw) {
    throw new Error(`Managed-server state changed during termination: ${statePath}`);
  }
  await unlink(statePath);
  // The lock belongs to its producer, not to the process described by the state.
}

