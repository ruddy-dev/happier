import * as childProcess from 'node:child_process';
import { ChildProcess } from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { startServerLight } from '../process/serverLight';
import { createRunDirs } from '../runDir';
import { runDeskServerFixture } from './deskServer';

// Only OS, filesystem and HTTP boundaries are substituted. Startup, lease registration,
// process stop, termination confirmation and the desk fixture all execute real code.
vi.mock('node:child_process', async importOriginal => ({
  ...await importOriginal<typeof childProcess>(), spawn: vi.fn(), spawnSync: vi.fn(),
}));
vi.mock('node:crypto', async importOriginal => ({ ...await importOriginal<typeof crypto>(), randomInt: vi.fn() }));
vi.mock('node:net', () => ({ createServer: () => {
  const probe = new EventEmitter() as EventEmitter & { listen: (port: number, host: string, cb: () => void) => void; close: (cb?: () => void) => void };
  probe.listen = (_port, _host, cb) => { queueMicrotask(cb); };
  probe.close = cb => { cb?.(); };
  return probe;
} }));
vi.mock('node:fs', async importOriginal => ({ ...await importOriginal<typeof fs>(), mkdirSync: vi.fn(), writeFileSync: vi.fn(), unlinkSync: vi.fn() }));
vi.mock('node:fs/promises', async importOriginal => ({ ...await importOriginal<typeof fsp>(), readdir: vi.fn(), readFile: vi.fn() }));

let root: string;
let alive: boolean;
let refuseStop: boolean;
let leaseFailure: boolean;
let earlyExit: boolean;
let staleLease: boolean;
let allocated: string[];
class BoundaryChild extends ChildProcess {
  override pid: number | undefined = 8123;
  override exitCode: number | null = null;
  override signalCode: NodeJS.Signals | null = null;
}
let child: BoundaryChild;
let children: BoundaryChild[];
let leaseError: Error;
const extraEnv = {
  HAPPIER_E2E_PROVIDER_SKIP_SERVER_SHARED_DEPS_BUILD: '1',
  HAPPIER_E2E_PROVIDER_SKIP_SERVER_GENERATE: '1',
  DATABASE_URL: 'file:synthetic-lifecycle.sqlite',
};

beforeEach(async () => {
  root = await fsp.mkdtemp(join(tmpdir(), 'desk-lifecycle-'));
  children = [];
  alive = false; refuseStop = false; leaseFailure = false; earlyExit = false; staleLease = false; allocated = [];
  leaseError = new Error('Synthetic lease write failure');
  vi.useFakeTimers();
  vi.mocked(crypto.randomInt).mockImplementation(() => 43210);
  vi.spyOn(process, 'platform', 'get').mockReturnValue('linux');
  vi.spyOn(process, 'kill').mockImplementation((_pid, signal) => {
    if (!alive || Math.abs(_pid) !== 8123) throw Object.assign(new Error('gone'), { code: 'ESRCH' });
    if (signal !== 0 && !refuseStop) {
      alive = false;
      queueMicrotask(() => { child.exitCode = 0; child.emit('exit', 0, null); child.emit('close', 0, null); child.stdout?.emit('end'); child.stderr?.emit('end'); });
    }
    return true;
  });
  const actualFs = await vi.importActual<typeof fs>('node:fs');
  vi.mocked(fs.mkdirSync).mockImplementation((path, options) => {
    if (String(path).includes('server-light-processes')) return undefined;
    return actualFs.mkdirSync(path, options);
  });
  vi.mocked(fs.unlinkSync).mockImplementation(path => {
    if (String(path).includes('server-light-processes')) return;
    actualFs.unlinkSync(path);
  });
  vi.mocked(fs.writeFileSync).mockImplementation((path, data, options) => {
    if (String(path).includes('server-light-processes')) {
      if (leaseFailure) throw leaseError;
      return;
    }
    actualFs.writeFileSync(path, data, options);
  });
  const actualFsp = await vi.importActual<typeof fsp>('node:fs/promises');
  vi.mocked(fsp.readdir).mockImplementation(((path: fs.PathLike, options: never) => {
    if (String(path).includes('server-light-processes')) return Promise.resolve(staleLease ? ['pid-8123.json'] : []);
    return actualFsp.readdir(path, options);
  }) as typeof fsp.readdir);
  vi.mocked(fsp.readFile).mockImplementation(((path: fs.PathLike, options: never) => {
    if (staleLease && String(path).endsWith('server-light-processes/pid-8123.json')) return actualFsp.readFile(join(root, 'lease.json'), options);
    if (String(path).endsWith('.log')) return Promise.resolve('');
    return actualFsp.readFile(path, options);
  }) as typeof fsp.readFile);
  vi.mocked(childProcess.spawnSync).mockImplementation((_command, args) => {
    const argv = args as string[];
    const pid = Number(argv[argv.indexOf('-p') + 1]);
    const found = pid === process.pid || (pid === 8123 && alive);
    const stdout = argv.includes('-axo')
      ? alive ? '8123 1 8123 Tue Mar 18 10:10:10 2026 node apps/server/dist/index.mjs start:light' : ''
      : found ? argv.includes('stat=') ? 'S' : argv.includes('lstart=') ? 'Tue Mar 18 10:10:10 2026' : 'node apps/server/dist/index.mjs start:light' : '';
    return { pid: 0, output: [null, stdout, null], stderr: '', status: argv.includes('-axo') || found ? 0 : 1, signal: null, stdout };
  });
  vi.mocked(childProcess.spawn).mockImplementation((_command, _args, options) => {
    // Startup preparation commands also use this boundary. They exit successfully.
    child = new BoundaryChild();
    children.push(child);
    child.stdout = new PassThrough(); child.stderr = new PassThrough();
    const env = (options as childProcess.SpawnOptions).env;
    const isServer = env?.PORT !== '0' && env?.PUBLIC_URL !== 'http://127.0.0.1:0';
    if (isServer) {
      alive = true;
      allocated.push(env!.HAPPIER_SERVER_LIGHT_DATA_DIR!);
      queueMicrotask(() => child.emit('spawn'));
    } else {
      const commandChild = child;
      queueMicrotask(() => { commandChild.emit('spawn'); commandChild.exitCode = 0; commandChild.stdout?.emit('end'); commandChild.stderr?.emit('end'); commandChild.emit('exit', 0, null); });
    }
    return child;
  });
  vi.stubGlobal('fetch', vi.fn(async () => {
    if (earlyExit) { alive = false; child.exitCode = 1; child.emit('exit', 1, null); }
    return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
  }));
});
afterEach(async () => {
  // These are synthetic children only. No signal or ownership sweep reached the host.
  alive = false;
  for (const spawned of children) {
    spawned.exitCode = 0;
    spawned.emit('exit', 0, null);
    spawned.stdout?.destroy(); spawned.stderr?.destroy();
  }
  vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  await fsp.rm(root, { recursive: true, force: true });
});

async function settle<T>(promise: Promise<T>) {
  let settled = false;
  const outcome = promise.then(value => ({ value, error: undefined }), (error: unknown) => ({ value: undefined, error })).finally(() => { settled = true; });
  await vi.waitFor(() => expect(settled).toBe(true), { timeout: 30_000, interval: 250 });
  return outcome;
}

async function start() {
  const testDir = join(root, 'startup');
  await fsp.mkdir(join(testDir, 'server-light-data'), { recursive: true });
  await fsp.writeFile(join(testDir, 'server-light-data', 'marker'), 'synthetic');
  return startServerLight({ testDir, dbProvider: 'sqlite', extraEnv, preserveExistingDataDir: true });
}

it('stops the owned child after post-spawn lease registration fails and preserves the startup cause', async () => {
  leaseFailure = true;
  const result = await settle(start());
  expect(result.error).toBeDefined();
  expect(alive).toBe(false);
  expect(result.error).toMatchObject({ dataDir: allocated[0], terminationConfirmed: true, cause: leaseError });
});

it('exposes the exact allocated directory and both failures without retrying unresolved ownership', async () => {
  leaseFailure = true; refuseStop = true;
  // This error normally permits retry; unresolved stop must prevent it.
  Object.assign(leaseError, { code: 'EADDRINUSE' });
  const result = await settle(start());
  expect(result.error).toMatchObject({ dataDir: allocated[0], terminationConfirmed: false });
  expect(allocated).toHaveLength(1);
  expect(alive).toBe(true);
  expect(result.error).toMatchObject({ cause: { errors: [leaseError, expect.objectContaining({ message: expect.stringContaining('termination was not confirmed') })] } });
  await expect(fsp.access(allocated[0])).resolves.toBeUndefined();
});

it('preserves early startup exit errors after confirming termination', async () => {
  earlyExit = true;
  const result = await settle(start());
  expect(result.error).toMatchObject({ dataDir: allocated[0], terminationConfirmed: true, cause: expect.objectContaining({ message: expect.stringContaining('exited before /health') }) });
  expect(alive).toBe(false);
});

it.each([false, true])('deletes the exact disposable directory only after verified stop, failed stop: %s', async failed => {
  refuseStop = failed;
  const run = createRunDirs({ logsDir: root });
  const result = await settle(runDeskServerFixture(run, extraEnv, async getServer => {
    await getServer('desk.j2.spec.ts', 'plain');
  }));
  expect(allocated).toHaveLength(1);
  expect(Boolean(result.error)).toBe(failed);
  expect(alive).toBe(failed);
  expect(await fsp.access(allocated[0]).then(() => true, () => false)).toBe(failed);
  await expect(fsp.access(root)).resolves.toBeUndefined();
});

it.each([false, true])('cleans failed startup only with owner-confirmed termination, failed stop: %s', async failed => {
  leaseFailure = true; refuseStop = failed;
  const result = await settle(runDeskServerFixture(createRunDirs({ logsDir: root }), extraEnv, async getServer => {
    await getServer('desk.j2.spec.ts', 'plain');
  }));
  expect(result.error).toBeDefined();
  expect(allocated).toHaveLength(1);
  expect(await fsp.access(allocated[0]).then(() => true, () => false)).toBe(failed);
});

it.each(['startup', 'stop'] as const)('does not replace a server or hide unresolved %s failure when the consumer catches it', async failure => {
  refuseStop = true; leaseFailure = failure === 'startup';
  const result = await settle(runDeskServerFixture(createRunDirs({ logsDir: root }), extraEnv, async getServer => {
    if (failure === 'stop') await getServer('first.spec.ts', 'plain');
    await getServer('second.spec.ts', 'plain').catch(() => {});
    await expect(getServer('third.spec.ts', 'plain')).rejects.toThrow();
  }));
  expect(result.error).toBeDefined();
  expect(allocated).toHaveLength(1);
  await expect(fsp.access(allocated[0])).resolves.toBeUndefined();
});

it('retains and exposes its exact directory when preparation has no confirmed process outcome', async () => {
  const testDir = join(root, 'preparation');
  const result = await settle(startServerLight({ testDir, dbProvider: 'postgres', extraEnv: { ...extraEnv, DATABASE_URL: '' } }));
  expect(result.error).toMatchObject({ dataDir: resolve(testDir, 'server-light-data'), terminationConfirmed: false });
  expect(allocated).toHaveLength(0);
  await expect(fsp.access(resolve(testDir, 'server-light-data'))).resolves.toBeUndefined();
});

it('still stops and removes the owned directory after the port guard rejects startup', async () => {
  vi.mocked(crypto.randomInt).mockImplementation(() => 3005);
  const result = await settle(runDeskServerFixture(createRunDirs({ logsDir: root }), extraEnv, async getServer => {
    await getServer('desk.j2.spec.ts', 'plain');
  }));
  expect(result.error).toBeDefined();
  expect(alive).toBe(false);
  expect(allocated).toHaveLength(1);
  await expect(fsp.access(allocated[0])).rejects.toMatchObject({ code: 'ENOENT' });
});

it('reuses a file server and permits its successor after confirmed teardown', async () => {
  const result = await settle(runDeskServerFixture(createRunDirs({ logsDir: root }), extraEnv, async getServer => {
    const first = await getServer('first.spec.ts', 'plain');
    expect(await getServer('first.spec.ts', 'plain')).toBe(first);
    await getServer('second.spec.ts', 'plain');
    await expect(fsp.access(first.dataDir)).rejects.toMatchObject({ code: 'ENOENT' });
  }));
  expect(result.error).toBeUndefined();
  expect(allocated).toHaveLength(2);
  for (const dataDir of allocated) await expect(fsp.access(dataDir)).rejects.toMatchObject({ code: 'ENOENT' });
});

it('rejects an unresolved orphan sweep before spawning a replacement server', async () => {
  staleLease = true; alive = true; refuseStop = true;
  const marker = JSON.stringify({ childPid: 8123, childStartTime: 'Tue Mar 18 10:10:10 2026',
    ownerPid: 9001, ownerStartTime: 'Tue Mar 18 09:09:09 2026', createdAtMs: 123 });
  await fsp.writeFile(join(root, 'lease.json'), marker);
  const result = await settle(start());
  expect(result.error).toMatchObject({ terminationConfirmed: false,
    cause: expect.objectContaining({ message: expect.stringContaining('termination was not confirmed') }) });
  expect(allocated).toEqual([]);
  expect(await fsp.readFile(join(root, 'lease.json'), 'utf8')).toBe(marker);
});
