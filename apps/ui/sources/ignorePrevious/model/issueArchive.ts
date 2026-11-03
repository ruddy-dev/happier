import type { ScmWorkingSnapshot } from '@/sync/domains/state/storageTypes';
import { buildWorkerPrBadge } from './workerPrBadge';
import type { SessionListRenderableSession } from '@/sync/domains/session/listing/sessionListRenderable';
import { getSessionStatus } from '@/utils/sessions/sessionUtils';
import { isDeskWorkerBusy } from './workerBusy';

export type IssueArchiveState = Readonly<{
    canArchive: boolean;
    archivableSessionIds: readonly string[];
    retired: boolean;
}>;

export type IssuePrStates = Readonly<Record<string, 'open' | 'merged' | 'closed' | 'unknown' | 'stale' | null>>;

/** No SCM evidence of a PR is distinct from an existing PR whose state or age is unknown. */
export function buildWorkerArchivePrState(snapshot: ScmWorkingSnapshot | null, nowMs: number): IssuePrStates[string] {
    if (!snapshot?.pullRequest) return null;
    const badge = buildWorkerPrBadge(snapshot, nowMs);
    if (!badge) return 'unknown';
    // Merge is irreversible. Only non-merged evidence needs a current lookup.
    if (badge.state === 'merged') return 'merged';
    if (badge.old || badge.fetchedAt === null) return 'stale';
    return badge.state;
}

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
        && workers.some(session => prStates[session.id] === 'merged')
        && !workers.some(session => ['open', 'unknown', 'stale'].includes(prStates[session.id] ?? ''));
    // Preserve live evidence until every non-evidence target has succeeded.
    inactive.sort((a, b) => Number(prStates[a.id] === 'merged') - Number(prStates[b.id] === 'merged'));
    return { canArchive, archivableSessionIds: canArchive ? inactive.map(session => session.id) : [], retired };
}
