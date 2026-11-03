import * as React from 'react';
import { t } from '@/text';
import { useActiveServerSnapshot } from '@/hooks/server/useActiveServerSnapshot';
import { useFeatureEnabled } from '@/hooks/server/useFeatureEnabled';
import type { WorkerUsageLimit } from '../model/workerUsageLimit';
import { useDeskNow } from '../model/useDeskNow';
import { useDeskPaint } from '../palette';
import { DeskText } from '../typography/DeskText';

export function WorkerUsageLimitLine({ status, sessionId, workerTitle }: { status: WorkerUsageLimit; sessionId: string; workerTitle?: string }) {
    const { paint } = useDeskPaint();
    const now = useDeskNow();
    const { serverId } = useActiveServerSnapshot();
    const recoveryEnabled = useFeatureEnabled('sessions.usageLimitRecovery', { scopeKind: 'spawn', serverId });
    let line = t('ignorePrevious.usageLimit.waitsForReset');
    if (status.resetAtMs !== null) {
        const reset = new Date(status.resetAtMs);
        const time = reset.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
        const resetTime = reset.toDateString() === new Date(now).toDateString()
            ? time : `${reset.toLocaleDateString(undefined, { weekday: 'short' })}, ${time}`;
        line = status.resetAtMs <= now
            ? t('ignorePrevious.usageLimit.resetDue')
            : t('ignorePrevious.usageLimit.waitsForResetAt', { time: resetTime });
    }
    if (recoveryEnabled && status.autoResumeArmed) line = t('ignorePrevious.usageLimit.autoResumeArmed', { line });
    return (
        <DeskText testID={`ip-worker-usage-limit-${sessionId}`} style={{ color: paint.mute, fontSize: 13 }}>
            {workerTitle ? t('ignorePrevious.usageLimit.workerLimit', { worker: workerTitle, line }) : line}
        </DeskText>
    );
}
