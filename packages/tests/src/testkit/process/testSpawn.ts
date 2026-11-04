import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { captureProcessTreeOwnership, terminateProcessTreeByPid, type ProcessTreeOwnership } from './processTree';

export type OwnedTestProcess = ChildProcess & {
  readonly ownership: ProcessTreeOwnership;
  stop: () => Promise<void>;
};

export function spawnTestProcess(
  command: string,
  args: readonly string[] = [],
  options: SpawnOptions = {},
): OwnedTestProcess {
  const child = spawn(command, [...args], {
    stdio: 'ignore',
    ...options,
  });

  if (!child.pid) {
    throw new Error('Failed to spawn test process');
  }

  const ownership = captureProcessTreeOwnership(child.pid);
  return Object.assign(child, { ownership,
    stop: () => terminateProcessTreeByPid(ownership.rootPid, { ownership, graceMs: 0, pollMs: 25 }),
  });
}

export function spawnDetachedTestProcess(
  command: string,
  args: readonly string[] = [],
  options: SpawnOptions = {},
): OwnedTestProcess {
  const child = spawnTestProcess(command, args, {
    detached: true,
    ...options,
  });
  child.unref();
  return child;
}

export function spawnDetachedInlineNodeTestProcess(source: string, options: SpawnOptions = {}): OwnedTestProcess {
  return spawnDetachedTestProcess(process.execPath, ['-e', source], options);
}
