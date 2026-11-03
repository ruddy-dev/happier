import * as React from 'react';
import { t } from '@/text';
import { useActiveServerSnapshot } from '@/hooks/server/useActiveServerSnapshot';
import { useFeatureEnabled } from '@/hooks/server/useFeatureEnabled';
import type { WorkerUsageLimit } from '../model/workerUsageLimit';
import { useDeskNow } from '../model/useDeskNow';
import { useDeskPaint } from '../palette';
import { DeskText } from '../typography/DeskText';

function formatResetTime(resetAtMs: number, now: number) {
    const reset = new Date(resetAtMs);
    const time = reset.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    return reset.toDateString() === new Date(now).toDateString()
        ? time : `${reset.toLocaleDateString(undefined, { weekday: 'short' })}, ${time}`;
}

export function WorkerUsageLimitSummary({ statuses, issueKey }: { statuses: readonly WorkerUsageLimit[]; issueKey: string }) {
    const { paint } = useDeskPaint();
    const now = useDeskNow();
    const nextReset = statuses.reduce<number | null>((earliest, status) => status.resetAtMs === null
        ? earliest : earliest === null ? status.resetAtMs : Math.min(earliest, status.resetAtMs), null);
    const count = t('ignorePrevious.usageLimit.limitedCount', { count: statuses.length });
    const line = nextReset === null ? count : nextReset <= now
        ? t('ignorePrevious.usageLimit.nextKnownResetDue', { count })
        : t('ignorePrevious.usageLimit.nextKnownResetAt', { count, time: formatResetTime(nextReset, now) });
    return (
        <DeskText testID={`ip-issue-usage-limits-${issueKey}`} numberOfLines={1} ellipsizeMode="tail"
            style={{ color: paint.mute, fontSize: 13, minWidth: 0, maxWidth: '100%' }}>
            {line}
        </DeskText>
    );
}

export function WorkerUsageLimitLine({ status, sessionId, compact = false }: { status: WorkerUsageLimit; sessionId: string; compact?: boolean }) {
    const { paint } = useDeskPaint();
    const now = useDeskNow();
    const { serverId } = useActiveServerSnapshot();
    const recoveryEnabled = useFeatureEnabled('sessions.usageLimitRecovery', { scopeKind: 'spawn', serverId });
    let line = t('ignorePrevious.usageLimit.waitsForReset');
    if (status.resetAtMs !== null) {
        line = status.resetAtMs <= now
            ? t('ignorePrevious.usageLimit.resetDue')
            : t('ignorePrevious.usageLimit.waitsForResetAt', { time: formatResetTime(status.resetAtMs, now) });
    }
    if (recoveryEnabled && status.autoResumeArmed) line = t('ignorePrevious.usageLimit.autoResumeArmed', { line });
    return (
        <DeskText testID={`ip-worker-usage-limit-${sessionId}`} numberOfLines={compact ? 1 : undefined} ellipsizeMode="tail"
            style={{ color: paint.mute, fontSize: 13, minWidth: 0, maxWidth: '100%' }}>
            {line}
        </DeskText>
    );
}
