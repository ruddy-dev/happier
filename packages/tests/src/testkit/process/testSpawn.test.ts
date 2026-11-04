import { once } from 'node:events';

import { describe, expect, it } from 'vitest';

import { isProcessAlive, observeOwnedProcessTree } from './processTree';
import { spawnDetachedInlineNodeTestProcess, spawnDetachedTestProcess, spawnTestProcess } from './testSpawn';
import { resolveTsxImportHookSpecifier } from './tsxImportHook';
import { repoRootDir } from '../paths';

describe('testSpawn', () => {
  it('spawns a child process and exposes its pid', async () => {
    const child = spawnTestProcess(process.execPath, ['-e', 'process.exit(0)'], {
      stdio: 'ignore',
    });

    expect(child.pid).toBeTypeOf('number');

    await new Promise<void>((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code) => {
        expect(code).toBe(0);
        resolve();
      });
    });
  });

  it('spawns detached inline node processes', async () => {
    const child = spawnDetachedInlineNodeTestProcess('setInterval(() => {}, 1000)');
    const pid = child.pid;

    expect(pid).toBeTypeOf('number');
    expect(isProcessAlive(pid!)).toBe(true);

    try {
      await child.stop();
      expect(isProcessAlive(pid!)).toBe(false);
    } finally {
      await child.stop();
    }
  });

  it('terminateProcessTreeByPid does not SIGTERM the caller when the target shares its process group', async () => {
    const tsxHookSpecifier = resolveTsxImportHookSpecifier();
    if (!tsxHookSpecifier) {
      throw new Error('tsx import hook is required for processTree regression coverage but could not be resolved');
    }

    const child = spawnDetachedTestProcess(
      process.execPath,
      [
        '--import',
        tsxHookSpecifier,
        '--input-type=module',
        '-e',
        [
          "import { spawnTestProcess } from './packages/tests/src/testkit/process/testSpawn.ts';",
          "const child = spawnTestProcess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });",
          "if (!child.pid) throw new Error('Failed to spawn child process');",
          "process.stdout.write('ready\\n');",
          "await new Promise(resolve => process.stdin.once('data', resolve));",
          'await child.stop();',
          'process.stdin.destroy();',
          'process.exit(0);',
          '',
        ].join('\n'),
      ],
      {
        cwd: repoRootDir(),
        stdio: ['pipe', 'pipe', 'ignore'],
      },
    );

    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => reject(new Error('Timed out waiting for detached processTree fixture to exit')), 20_000);
    });
    try {
      await Promise.race([once(child.stdout!, 'data'), timedOut]);
      observeOwnedProcessTree(child.ownership);
      expect(child.ownership.processes.size).toBeGreaterThan(1);
      child.stdin!.end('release');
      const [code, signal] = await Promise.race([
        once(child, 'exit') as Promise<[number | null, NodeJS.Signals | null]>,
        timedOut,
      ]);
      expect(code).toBe(0);
      expect(signal).toBeNull();
    } finally {
      clearTimeout(timeout);
      await child.stop();
    }
  });
});
