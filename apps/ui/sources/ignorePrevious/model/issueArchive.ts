import type { SessionListRenderableSession } from '@/sync/domains/session/listing/sessionListRenderable';
import { getSessionStatus } from '@/utils/sessions/sessionUtils';
import { isDeskWorkerBusy } from './workerBusy';

export type IssueArchiveState = Readonly<{
    canArchive: boolean;
    archivableSessionIds: readonly string[];
    retired: boolean;
}>;

export type IssuePrStates = Readonly<Record<string, 'open' | 'merged' | 'closed' | 'unknown' | null>>;

export function deriveIssueArchive(
    issueKey: string | null,
    sessions: readonly SessionListRenderableSession[],
    prStates: IssuePrStates,
    coordinatorId: string | null,
    nowMs: number,
): IssueArchiveState {
    const workers = sessions.filter(session => session.id !== coordinatorId);
    const blocked = workers.some(session => session.hasPendingPermissionRequests
        || session.hasPendingUserActionRequests || isDeskWorkerBusy(getSessionStatus(session, nowMs).state));
    const retired = issueKey !== null && workers.length > 0 && !blocked && workers.every(session => Boolean(session.archivedAt));
    const inactive = workers.filter(session => !session.archivedAt && session.active === false);
    const canArchive = issueKey !== null && !blocked && inactive.length > 0
        && workers.some(session => prStates[session.id] === 'merged');
    return { canArchive, archivableSessionIds: canArchive ? inactive.map(session => session.id) : [], retired };
}
