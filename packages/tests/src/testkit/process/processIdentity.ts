import { spawnSync } from 'node:child_process';

export type ProcessInspectionResult =
    | {
        ok: true;
        command: string;
        startTime: string;
    }
    | {
        ok: false;
        reason: 'not_found' | 'ps_missing' | 'inspect_failed';
    };

export function inspectOwnedProcess(pid: number): ProcessInspectionResult {
    if (!Number.isInteger(pid) || pid <= 1) {
        return { ok: false, reason: 'not_found' };
    }

    if (process.platform === 'win32') return { ok: false, reason: 'inspect_failed' };

    try {
        let commandRes = spawnSync('ps', ['-o', 'args=', '-p', String(pid), '-ww'], { encoding: 'utf8' });
        if (commandRes.status !== 0) {
            commandRes = spawnSync('ps', ['-o', 'args=', '-p', String(pid)], { encoding: 'utf8' });
        }
        if (commandRes.error) {
            return { ok: false, reason: (commandRes.error as NodeJS.ErrnoException).code === 'ENOENT' ? 'ps_missing' : 'inspect_failed' };
        }
        if (commandRes.status !== 0) {
            // ps failure alone is not evidence that the process is gone.
            try { process.kill(pid, 0); }
            catch (error) {
                if ((error as NodeJS.ErrnoException).code === 'ESRCH') return { ok: false, reason: 'not_found' };
            }
            return { ok: false, reason: 'inspect_failed' };
        }

        let startTimeRes = spawnSync('ps', ['-o', 'lstart=', '-p', String(pid), '-ww'], { encoding: 'utf8' });
        if (startTimeRes.status !== 0) {
            startTimeRes = spawnSync('ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8' });
        }
        if (startTimeRes.status !== 0) {
            return { ok: false, reason: 'inspect_failed' };
        }

        const command = String(commandRes.stdout || '').trim();
        const startTime = String(startTimeRes.stdout || '').trim();
        if (!command || !startTime) {
            return { ok: false, reason: 'inspect_failed' };
        }

        return {
            ok: true,
            command,
            startTime,
        };
    } catch (error) {
        const err = error as NodeJS.ErrnoException;
        if (err?.code === 'ENOENT') return { ok: false, reason: 'ps_missing' };
        return { ok: false, reason: 'inspect_failed' };
    }
}

