import type { SessionListRenderableSession } from '@/sync/domains/session/listing/sessionListRenderable';
import { readSessionUsageLimitRecoveryForIssue } from '@happier-dev/protocol';
import { hasMeaningfulActivityAfterRuntimeIssue } from '@/components/sessions/usageLimitRecovery/sessionUsageLimitActivityStaleness';
import {
    isUsageLimitIssue,
    readResetAtMs,
    shouldSurfaceRecoveryIssue,
} from '@/components/sessions/usageLimitRecovery/sessionUsageLimitRecoveryPresentation';

export type WorkerUsageLimit = Readonly<{
    current: true;
    resetAtMs: number | null;
    /** Null when recovery metadata has not loaded. */
    autoResumeArmed: boolean | null;
}>;

/** List evidence owns freshness; optional already-loaded recovery metadata supplies auto-resume. */
export function workerUsageLimit(row: SessionListRenderableSession, recoveryValue?: unknown): WorkerUsageLimit | null {
    const issue = row.lastRuntimeIssue;
    if (!isUsageLimitIssue(issue)) return null;
    const recovery = readSessionUsageLimitRecoveryForIssue(recoveryValue, issue);
    if (!shouldSurfaceRecoveryIssue({
        issue,
        recovery,
        latestTurnStatus: row.latestTurnStatus,
        hasActivityAfterRuntimeIssue: hasMeaningfulActivityAfterRuntimeIssue(row),
    })) return null;
    return {
        current: true,
        resetAtMs: readResetAtMs(issue, recovery),
        autoResumeArmed: recoveryValue === undefined ? null
            : recovery?.status === 'armed' || recovery?.status === 'waiting' || recovery?.status === 'checking',
    };
}
