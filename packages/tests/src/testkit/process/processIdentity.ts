import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { processInstanceFingerprintMatches, readProcessInstanceFingerprintSync } from '@happier-dev/cli-common/processInstance';

export type ProcessInspectionResult =
    | {
        ok: true;
        command: string;
        startTime: string;
        state?: string;
        processInstanceFingerprint?: string;
    }
    | {
        ok: false;
        reason: 'not_found' | 'ps_missing' | 'inspect_failed';
    };

function isPositivePosixAbsence(pid: number, result: SpawnSyncReturns<string>): boolean {
    // A failed query alone is not absence. Require an empty, diagnostic-free
    // no-match result and independent OS confirmation at every query stage.
    if (result.error || result.status !== 1 || String(result.stdout ?? '').trim() || String(result.stderr ?? '').trim()) return false;
    try { process.kill(pid, 0); }
    catch (error) { return (error as NodeJS.ErrnoException).code === 'ESRCH'; }
    return false;
}

export function inspectOwnedProcess(pid: number): ProcessInspectionResult {
    if (!Number.isInteger(pid) || pid <= 1) {
        return { ok: false, reason: 'not_found' };
    }

    if (process.platform === 'win32') {
        try {
            // Use the existing CreationDate contract, including its UTC/O format.
            const before = readProcessInstanceFingerprintSync(pid, { spawnSyncImpl: spawnSync });
            const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', [
                `$p = Get-CimInstance Win32_Process -Filter "ProcessId=${pid}" -ErrorAction Stop`,
                'if ($null -eq $p) { exit 3 }',
                '$p.CommandLine',
            ].join('; ')], { encoding: 'utf8', windowsHide: true });
            if (!result.error && result.status === 3) {
                try { process.kill(pid, 0); }
                catch (error) {
                    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return { ok: false, reason: 'not_found' };
                }
            }
            const command = String(result.stdout ?? '').trim();
            if (result.error || result.status !== 0 || !command || !before) return { ok: false, reason: 'inspect_failed' };
            const after = readProcessInstanceFingerprintSync(pid, { spawnSyncImpl: spawnSync });
            if (!processInstanceFingerprintMatches(before, after)) return { ok: false, reason: 'inspect_failed' };
            return { ok: true, command, startTime: before, processInstanceFingerprint: before };
        } catch {
            return { ok: false, reason: 'inspect_failed' };
        }
    }

    try {
        let commandRes = spawnSync('ps', ['-o', 'args=', '-p', String(pid), '-ww'], { encoding: 'utf8' });
        if (commandRes.status !== 0) {
            commandRes = spawnSync('ps', ['-o', 'args=', '-p', String(pid)], { encoding: 'utf8' });
        }
        if (commandRes.error) {
            return { ok: false, reason: (commandRes.error as NodeJS.ErrnoException).code === 'ENOENT' ? 'ps_missing' : 'inspect_failed' };
        }
        if (commandRes.status !== 0) {
            return { ok: false, reason: isPositivePosixAbsence(pid, commandRes) ? 'not_found' : 'inspect_failed' };
        }
        const command = String(commandRes.stdout ?? '').trim();
        if (!command) return { ok: false, reason: 'inspect_failed' };

        let startTimeRes = spawnSync('ps', ['-o', 'lstart=', '-p', String(pid), '-ww'], { encoding: 'utf8' });
        if (startTimeRes.status !== 0) {
            startTimeRes = spawnSync('ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8' });
        }
        if (startTimeRes.error || startTimeRes.status !== 0) {
            return { ok: false, reason: isPositivePosixAbsence(pid, startTimeRes) ? 'not_found' : 'inspect_failed' };
        }

        const startTime = String(startTimeRes.stdout || '').trim();
        if (!startTime) {
            return { ok: false, reason: 'inspect_failed' };
        }

        const stateResult = spawnSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' });
        const state = String(stateResult.stdout ?? '').trim();
        if (stateResult.error || stateResult.status !== 0) {
            return { ok: false, reason: isPositivePosixAbsence(pid, stateResult) ? 'not_found' : 'inspect_failed' };
        }
        if (!/^[A-Z][A-Za-z<+]*$/.test(state)) {
            return { ok: false, reason: 'inspect_failed' };
        }
        // A zombie may have lost its original args. Re-read birth after observing
        // state so a recycled PID cannot borrow the earlier process's birth proof.
        if (state.startsWith('Z')) {
            const birth = spawnSync('ps', ['-o', 'lstart=', '-p', String(pid), '-ww'], { encoding: 'utf8' });
            if (birth.error || birth.status !== 0) {
                return { ok: false, reason: isPositivePosixAbsence(pid, birth) ? 'not_found' : 'inspect_failed' };
            }
            if (String(birth.stdout ?? '').trim() !== startTime) {
                return { ok: false, reason: 'inspect_failed' };
            }
        }
        return {
            ok: true,
            state,
            command,
            startTime,
        };
    } catch (error) {
        const err = error as NodeJS.ErrnoException;
        if (err?.code === 'ENOENT') return { ok: false, reason: 'ps_missing' };
        return { ok: false, reason: 'inspect_failed' };
    }
}

