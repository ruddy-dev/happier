import * as childProcess from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { captureProcessTreeOwnership } from './processTree';
import { withCleanup } from './withCleanup';
import { daemonStatePath, stopDaemonFromHomeDir } from '../daemon/daemon';
import { stopOpenCodeManagedServerFromHomeDir } from '../providers/opencode/stopOpenCodeManagedServerFromHomeDir';

// Real temporary files, real ownership/termination logic. No host process,
// signal, ps invocation or network request may escape these OS boundaries.
vi.mock('node:child_process', () => ({ spawn: vi.fn(), spawnSync: vi.fn() }));
const start = 'Tue Mar 18 10:10:10 2026';
const command = 'owned-worker';
const hash = createHash('sha256').update(command).digest('hex');
let alive: boolean;
let denySignal: boolean;
let inspectFails: boolean;
let currentStart: string;
let currentCommand: string;
let signals: number[];
let onSignal: (() => void) | undefined;
beforeEach(() => {
  vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin');
  onSignal = undefined;
  alive = true; denySignal = false; inspectFails = false; currentStart = start; currentCommand = command; signals = [];
  vi.mocked(childProcess.spawnSync).mockImplementation((_command, args) => {
    const argv = args as string[];
    const listing = argv.includes('-axo');
    const stdout = !alive || inspectFails ? '' : listing
      ? `8123 1 8123 ${currentStart} ${currentCommand}`
      : argv.includes('stat=') ? 'S' : argv.includes('lstart=') ? currentStart : currentCommand;
    return { pid: 0, output: [null, stdout, null], stdout, stderr: '', status: inspectFails ? 2 : listing || alive ? 0 : 1, signal: null };
  });
  vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
    if (Math.abs(pid) !== 8123 || !alive) throw Object.assign(new Error('gone'), { code: 'ESRCH' });
    if (signal !== 0) {
      signals.push(pid);
      if (denySignal) throw Object.assign(new Error('denied'), { code: 'EPERM' });
      onSignal?.();
      alive = false;
    }
    return true;
  });
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('unreachable'); }));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

for (const kind of ['daemon', 'managed-server'] as const) {
  async function fixture(fingerprint: boolean | string, commandProof = true) {
    const home = await mkdtemp(join(tmpdir(), 'happier-caller-ownership-'));
    const dir = join(home, kind === 'daemon' ? 'tmp/daemon-sessions' : 'opencode');
    await mkdir(dir, { recursive: true });
    const path = join(dir, kind === 'daemon' ? 'pid-8123.json' : 'managed-server.json');
    const record = JSON.stringify({ pid: 8123, happyHomeDir: home, startedBy: 'daemon', ...(commandProof ? { processCommandHash: hash } : {}),
      baseUrl: 'http://127.0.0.1:1', startedAtMs: 123, ...(commandProof ? { expectedCmdlineHash: hash } : {}),
      ...(fingerprint ? { processInstanceFingerprint: typeof fingerprint === 'string' ? fingerprint : `darwin-ps:${start}` } : {}) });
    await writeFile(path, record);
    await writeFile(`${path}.lock`, 'another-lock-owner');
    await writeFile(daemonStatePath(home), JSON.stringify({ pid: 9000, httpPort: 1 }));
    return { home, path, record, stop: () => kind === 'daemon'
      ? stopDaemonFromHomeDir(home, { hardKill: false, gracefulTimeoutMs: 0 })
      : stopOpenCodeManagedServerFromHomeDir(home) };
  }

  it.each(['no-command-proof', 'legacy', 'reused', 'command-changed', 'inspection-failed', 'failed-stop'] as const)(
    `${kind} retains marker and lock and reports %s`, async scenario => {
      const f = await fixture(scenario !== 'legacy', scenario !== 'no-command-proof');
      try {
        if (scenario === 'reused') currentStart = 'Tue Mar 18 11:11:11 2026';
        if (scenario === 'command-changed') currentCommand = 'unrelated-worker';
        if (scenario === 'inspection-failed') inspectFails = true;
        if (scenario === 'failed-stop') denySignal = true;
        await expect(f.stop()).rejects.toThrow(/identity|ownership|termination|inspect/i);
        expect(await readFile(f.path, 'utf8')).toBe(f.record);
        expect(await readFile(`${f.path}.lock`, 'utf8')).toBe('another-lock-owner');
        if (scenario !== 'failed-stop') expect(signals).toEqual([]);
        else {
          denySignal = false;
          await f.stop();
          expect(alive).toBe(false);
          await expect(readFile(f.path, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
          expect(await readFile(`${f.path}.lock`, 'utf8')).toBe('another-lock-owner');
        }
      } finally { await rm(f.home, { recursive: true, force: true }); }
    },
  );

  it(`${kind} preserves both the scenario filesystem error and refused cleanup`, async () => {
    const f = await fixture(false);
    const scenarioPath = join(f.home, 'missing-scenario-input');
    try {
      const result = withCleanup(() => readFile(scenarioPath, 'utf8'), f.stop);
      await expect(result).rejects.toMatchObject({ errors: [
        expect.objectContaining({ code: 'ENOENT', path: scenarioPath }),
        expect.objectContaining({ message: expect.stringMatching(/ownership|cleanup/i) }),
      ] });
      expect(await readFile(f.path, 'utf8')).toBe(f.record);
      expect(signals).toEqual([]);
    } finally { await rm(f.home, { recursive: true, force: true }); }
  });

  it(`${kind} retains the original scenario error when cleanup succeeds`, async () => {
    const f = await fixture(true);
    const scenarioPath = join(f.home, 'missing-scenario-input');
    try {
      await expect(withCleanup(() => readFile(scenarioPath, 'utf8'), f.stop)).rejects.toMatchObject({ code: 'ENOENT', path: scenarioPath });
      expect(signals).toEqual([8123]);
      await expect(readFile(f.path, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    } finally { await rm(f.home, { recursive: true, force: true }); }
  });

  it(`${kind} removes an unchanged positively absent marker without signalling`, async () => {
    const f = await fixture(true);
    try {
      alive = false;
      await f.stop();
      expect(signals).toEqual([]);
      await expect(readFile(f.path, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
      expect(await readFile(`${f.path}.lock`, 'utf8')).toBe('another-lock-owner');
    } finally { await rm(f.home, { recursive: true, force: true }); }
  });

  it.each(['executable-error', 'query-error'] as const)(`${kind} retains the exact marker after %s even if PID probing says absent`, async failure => {
    const f = await fixture(true);
    try {
      inspectFails = true;
      alive = false;
      // An executable/probe error is not a successful empty process query.
      vi.mocked(childProcess.spawnSync).mockReturnValue({ pid: 0, output: [null, '', null], stdout: '', stderr: '',
        status: failure === 'query-error' ? 2 : null,
        ...(failure === 'executable-error' ? { error: Object.assign(new Error('inspection unavailable'), { code: 'EACCES' }) } : {}), signal: null });
      await expect(f.stop()).rejects.toThrow(/ownership|identity|inspection/i);
      expect(await readFile(f.path, 'utf8')).toBe(f.record);
      expect(signals).toEqual([]);
    } finally { await rm(f.home, { recursive: true, force: true }); }
  });

  if (kind === 'daemon') it.each(['unproven', 'malformed'] as const)('attempts later proven markers after an earlier %s marker fails', async scenario => {
    const f = await fixture(true);
    const badPath = join(f.home, 'tmp/daemon-sessions/pid-0000.json');
    const bad = scenario === 'malformed' ? '{bad' : JSON.stringify({ pid: 8123, startedBy: 'daemon', processCommandHash: hash });
    try {
      await writeFile(badPath, bad);
      await expect(f.stop()).rejects.toThrow(/ownership|cleanup/i);
      expect(signals).toEqual([8123]);
      expect(await readFile(badPath, 'utf8')).toBe(bad);
      await expect(readFile(f.path, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    } finally { await rm(f.home, { recursive: true, force: true }); }
  });

  if (kind === 'daemon') it('attempts proven markers in other directories after a marker directory cannot be read', async () => {
    const f = await fixture(true);
    const legacyDir = join(f.home, 'tmp/daemon-sessions');
    const otherDir = join(f.home, 'tmp/daemon-sessions.other');
    const otherMarker = join(otherDir, 'pid-8123.json');
    try {
      await mkdir(otherDir);
      await writeFile(otherMarker, f.record);
      await rm(legacyDir, { recursive: true });
      await writeFile(legacyDir, 'unreadable-as-directory');
      await expect(f.stop()).rejects.toThrow();
      expect(signals).toEqual([8123]);
      expect(await readFile(legacyDir, 'utf8')).toBe('unreadable-as-directory');
      await expect(readFile(otherMarker, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    } finally { await rm(f.home, { recursive: true, force: true }); }
  });

  it(`${kind} preserves a record replaced while its old process is stopping`, async () => {
    const f = await fixture(true);
    const replacement = JSON.stringify({ replacement: true });
    try {
      onSignal = () => writeFileSync(f.path, replacement);
      await expect(f.stop()).rejects.toThrow(/changed during termination/);
      expect(signals).toEqual([8123]);
      expect(await readFile(f.path, 'utf8')).toBe(replacement);
      expect(await readFile(`${f.path}.lock`, 'utf8')).toBe('another-lock-owner');
    } finally { await rm(f.home, { recursive: true, force: true }); }
  });

  it(`${kind} stops a proven process and removes only its unchanged record`, async () => {
    const f = await fixture(true);
    try {
      expect(await withCleanup(() => readFile(f.path, 'utf8'), f.stop)).toBe(f.record);
      expect(signals).toEqual([8123]);
      expect(alive).toBe(false);
      await expect(readFile(f.path, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
      expect(await readFile(`${f.path}.lock`, 'utf8')).toBe('another-lock-owner');
    } finally { await rm(f.home, { recursive: true, force: true }); }
  });

  if (kind === 'managed-server') it.each(['owned', 'reused', 'absent', 'failed-query'] as const)(
    'validates Windows persisted birth proof and exact state for %s', async scenario => {
      const birth = '2026-03-18T10:10:10.1234567Z';
      const f = await fixture(`win32-cim:${birth}`);
      vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
      currentStart = scenario === 'reused' ? '2026-03-18T10:10:10.1234568Z' : birth;
      alive = scenario !== 'absent' && scenario !== 'failed-query';
      vi.mocked(childProcess.spawnSync).mockImplementation((executable, args) => {
        expect(executable).toBe('powershell.exe');
        const script = String(args?.at(-1));
        const listing = !script.includes('ProcessId=');
        const stdout = scenario === 'failed-query' ? '' : listing
          ? JSON.stringify(alive ? [{ pid: 8123, ppid: 1, startTime: `win32-cim:${currentStart}`, command }] : [])
          : alive ? script.includes('CommandLine') ? command : currentStart : '';
        return { pid: 0, output: [null, stdout, null], stdout, stderr: '',
          status: scenario === 'failed-query' ? 2 : listing || alive ? 0 : 3, signal: null };
      });
      try {
        if (scenario === 'reused' || scenario === 'failed-query') {
          await expect(f.stop()).rejects.toThrow(/ownership|identity/i);
          expect(await readFile(f.path, 'utf8')).toBe(f.record);
          expect(signals).toEqual([]);
        } else {
          await f.stop();
          await expect(readFile(f.path, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
          expect(signals).toEqual(scenario === 'owned' ? [8123] : []);
        }
        expect(await readFile(`${f.path}.lock`, 'utf8')).toBe('another-lock-owner');
      } finally { await rm(f.home, { recursive: true, force: true }); }
    },
  );
}

it('refuses daemon PID-only fallback and preserves its state', async () => {
  const home = await mkdtemp(join(tmpdir(), 'happier-daemon-unproven-'));
  const raw = JSON.stringify({ pid: 8123, httpPort: 1 });
  try {
    await writeFile(daemonStatePath(home), raw);
    await expect(stopDaemonFromHomeDir(home, {
      gracefulTimeoutMs: 0,
      inspectProcess: () => ({ ok: true, command, looksLikeDaemon: true }),
    })).rejects.toThrow(/captured.*identity|ownership/i);
    expect(signals).toEqual([]);
    expect(await readFile(daemonStatePath(home), 'utf8')).toBe(raw);
  } finally { await rm(home, { recursive: true, force: true }); }
});

it('carries a spawned daemon identity into fallback termination', async () => {
  const home = await mkdtemp(join(tmpdir(), 'happier-daemon-owned-'));
  const ownership = captureProcessTreeOwnership(8123);
  try {
    await writeFile(daemonStatePath(home), JSON.stringify({ pid: 8123, httpPort: 1 }));
    await stopDaemonFromHomeDir(home, {
      ownership,
      gracefulTimeoutMs: 0,
      inspectProcess: () => ({ ok: true, command, looksLikeDaemon: true }),
    });
    expect(signals).toEqual([8123]);
    expect(alive).toBe(false);
  } finally { await rm(home, { recursive: true, force: true }); }
});
