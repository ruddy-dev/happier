import { spawn, type ChildProcess } from 'node:child_process';
import { createWriteStream } from 'node:fs';

import { resolveNpmCommandInvocation, resolveYarnCommandInvocation, type CommandInvocation } from './commands';
import { captureProcessTreeOwnership, observeOwnedProcessTree, terminateProcessTreeByPid, type ProcessTreeOwnership } from './processTree';

export type SpawnedProcess = {
  readonly ownership?: ProcessTreeOwnership;
  child: ChildProcess;
  stdoutPath: string;
  stderrPath: string;
  stop: (signal?: NodeJS.Signals) => Promise<void>;
};

function attachExitCleanup(
  child: ChildProcess,
  ownership: ProcessTreeOwnership,
): () => void {
  const cleanup = () => {
    if (typeof child.pid !== 'number' || child.pid <= 0) return;
    void terminateProcessTreeByPid(child.pid, {
      graceMs: 0,
      pollMs: 25,
      skipAliveCheck: true,
      ownership,
    }).catch(error => console.error('Owned process exit cleanup failed', error));
  };

  const onExit = () => {
    cleanup();
  };
  const onSignal = () => {
    cleanup();
  };

  process.once('exit', onExit);
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  process.once('SIGHUP', onSignal);

  return () => {
    process.off('exit', onExit);
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
    process.off('SIGHUP', onSignal);
  };
}

function waitForStreamDrain(stream: NodeJS.WritableStream, timeoutMs = 10_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const writable = stream as NodeJS.WritableStream & {
      writableFinished?: boolean;
      destroyed?: boolean;
    };

    if (writable.writableFinished || writable.destroyed) {
      resolve();
      return;
    }

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for log stream drain after ${timeoutMs}ms`));
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timer);
      stream.off('finish', onFinish);
      stream.off('close', onFinish);
      stream.off('error', onError);
    };

    const onFinish = () => {
      cleanup();
      resolve();
    };
    const onError = (error: unknown) => {
      cleanup();
      reject(error instanceof Error ? error : new Error(String(error)));
    };

    stream.once('finish', onFinish);
    stream.once('close', onFinish);
    stream.once('error', onError);
  });
}

function resolveSpawnCommandInvocation(command: string, args: readonly string[], env?: NodeJS.ProcessEnv): CommandInvocation {
  const normalized = command.trim().toLowerCase();
  if (normalized === 'yarn' || normalized === 'yarn.cmd') {
    return resolveYarnCommandInvocation(args, { npmExecPath: env?.npm_execpath });
  }
  if (normalized === 'npm' || normalized === 'npm.cmd') {
    return resolveNpmCommandInvocation(args, { npmExecPath: env?.npm_execpath });
  }
  return { command, args: [...args] };
}

export async function runLoggedCommand(params: {
  command: string;
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  stdoutPath: string;
  stderrPath: string;
  timeoutMs?: number;
}): Promise<void> {
  const invocation = resolveSpawnCommandInvocation(params.command, params.args, params.env);
  const child = spawn(invocation.command, invocation.args, {
    cwd: params.cwd,
    env: params.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
    ...(invocation.windowsVerbatimArguments
      ? { windowsVerbatimArguments: invocation.windowsVerbatimArguments }
      : {}),
  });

  const stdout = createWriteStream(params.stdoutPath, { flags: 'w' });
  const stderr = createWriteStream(params.stderrPath, { flags: 'w' });
  const ownership = captureProcessTreeOwnership(child.pid ?? 0);
  observeOwnedProcessTree(ownership);
  const detachCleanup = attachExitCleanup(child, ownership);

  child.stdout?.pipe(stdout);
  child.stderr?.pipe(stderr);

  const timeoutMs = params.timeoutMs ?? 120_000;
  const streamDrainTimeoutMs = Math.max(10_000, Math.min(timeoutMs, 120_000));

  const outcome = await new Promise<{ ok: true } | { ok: false; error: Error }>((resolve) => {
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      const error = new Error(`${params.command} ${params.args.join(' ')} timed out after ${timeoutMs}ms`);
      void terminateProcessTreeByPid(child.pid ?? 0, { graceMs: 0, pollMs: 25, ownership }).then(
        () => resolve({ ok: false, error }),
        stopError => resolve({ ok: false, error: new AggregateError([error, stopError], 'Command timed out and owned process termination failed') }),
      );
    }, timeoutMs);

    child.on('error', (err) => {
      clearTimeout(timer);
      detachCleanup();
      try {
        stdout.end();
      } catch {
        // ignore
      }
      try {
        stderr.end();
      } catch {
        // ignore
      }
      if (!timedOut) resolve({ ok: false, error: err instanceof Error ? err : new Error(String(err)) });
    });
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      detachCleanup();
      if (timedOut) return;
      if (code === 0) {
        resolve({ ok: true });
        return;
      }

      const detail = signal ? `signal ${signal}` : `code ${code}`;
      resolve({ ok: false, error: new Error(`${params.command} exited with ${detail}`) });
    });
  });

  let drainError: Error | null = null;
  try {
    await Promise.all([waitForStreamDrain(stdout, streamDrainTimeoutMs), waitForStreamDrain(stderr, streamDrainTimeoutMs)]);
  } catch (error: unknown) {
    drainError = error instanceof Error ? error : new Error(String(error));
  }

  if (drainError) {
    if (!outcome.ok) {
      throw new Error(
        `${outcome.error.message}; ${drainError.message} ` +
        `(stdout=${params.stdoutPath} stderr=${params.stderrPath})`,
        { cause: outcome.error },
      );
    }
    throw drainError;
  }

  if (!outcome.ok) {
    throw new Error(
      `${outcome.error.message} (stdout=${params.stdoutPath} stderr=${params.stderrPath})`,
      { cause: outcome.error },
    );
  }
}

export function spawnLoggedProcess(params: {
  command: string;
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  stdoutPath: string;
  stderrPath: string;
  cleanupDescendantsOnExit?: boolean;
}): SpawnedProcess {
  const invocation = resolveSpawnCommandInvocation(params.command, params.args, params.env);
  const child = spawn(invocation.command, invocation.args, {
    cwd: params.cwd,
    env: params.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
    ...(invocation.windowsVerbatimArguments
      ? { windowsVerbatimArguments: invocation.windowsVerbatimArguments }
      : {}),
  });

  const stdout = createWriteStream(params.stdoutPath, { flags: 'w' });
  const stderr = createWriteStream(params.stderrPath, { flags: 'w' });
  const ownership = captureProcessTreeOwnership(child.pid ?? 0);
  const detachCleanup = attachExitCleanup(child, ownership);
  let descendantPoller: ReturnType<typeof setTimeout> | null = null;
  let descendantPollerActive = true;
  const pollStartedAtMs = Date.now();
  // Match the established testkit policy: capture short-lived startup wrappers,
  // then leave the event loop available instead of spawning synchronous ps every millisecond.
  const fastPollWindowMs = 1_000;
  const fastPollMs = 25;
  const slowPollMs = 250;
  const pollDescendants = () => {
    if (!descendantPollerActive) return;
    if (typeof child.pid === 'number' && child.pid > 0) {
      observeOwnedProcessTree(ownership);
    }
    const nextDelay = Date.now() - pollStartedAtMs < fastPollWindowMs ? fastPollMs : slowPollMs;
    descendantPoller = setTimeout(pollDescendants, nextDelay);
    descendantPoller.unref?.();
  };
  if (descendantPollerActive) pollDescendants();

  const stopDescendantPolling = () => {
    descendantPollerActive = false;
    if (descendantPoller) clearTimeout(descendantPoller);
    descendantPoller = null;
  };

  child.stdout?.pipe(stdout);
  child.stderr?.pipe(stderr);

  const stop = async (signal: NodeJS.Signals = 'SIGTERM') => {
    stopDescendantPolling();

    if (typeof child.pid !== 'number' || child.pid <= 0) {
      throw new Error('Cannot confirm termination without an owned process id');
    }

    await terminateProcessTreeByPid(child.pid, {
      signal,
      graceMs: 10_000,
      pollMs: 25,
      skipAliveCheck: true,
      ownership,
    });
  };

  child.once('exit', () => {
    stopDescendantPolling();
    if (params.cleanupDescendantsOnExit !== false && ownership.processes.size > 1) {
      void terminateProcessTreeByPid(child.pid ?? 0, {
        graceMs: 0,
        pollMs: 25,
        skipAliveCheck: true,
        ownership,
      }).catch(error => console.error('Owned descendant exit cleanup failed', error));
    }
    detachCleanup();
  });

  return { child, stdoutPath: params.stdoutPath, stderrPath: params.stderrPath, stop, ownership };
}
