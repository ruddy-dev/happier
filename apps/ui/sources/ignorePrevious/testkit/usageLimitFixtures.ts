import { buildUsageLimitIssueFingerprint, type SessionRuntimeIssueV1, type SessionUsageLimitRecoveryV1 } from '@happier-dev/protocol';

export function usageLimitIssue(occurredAt: number, resetAtMs: number | null = null): SessionRuntimeIssueV1 {
    return {
        v: 1, scope: 'primary_session', status: 'failed', source: 'usage_limit', code: 'usage_limit', occurredAt,
        usageLimit: { v: 1, resetAtMs, retryAfterMs: null, quotaScope: 'account', recoverability: 'wait' },
    };
}

export function armedUsageLimitRecovery(issue: SessionRuntimeIssueV1): SessionUsageLimitRecoveryV1 {
    return {
        v: 1, status: 'armed', issueFingerprint: buildUsageLimitIssueFingerprint(issue),
        armedAtMs: issue.occurredAt, resetAtMs: issue.usageLimit?.resetAtMs ?? null,
        nextCheckAtMs: null, attemptCount: 0, maxAttempts: 3, lastProbeError: null,
        resumePromptMode: 'standard', selectedAuth: { kind: 'native' },
    };
}
