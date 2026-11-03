import { archiveSessionWithPendingState } from '@/components/sessions/sessionStopArchiveFlow';
import { getActiveServerSnapshot } from '@/sync/domains/server/serverRuntime';
import { storage } from '@/sync/domains/state/storage';
import { sessionArchiveWithServerScope } from '@/sync/ops/sessions';

import { getStoredCoordinatorId } from '../deskPrefs';
import { selectDeskSessions } from '../useDeskSessions';
import { pickCoordinatorSessionId } from './coordinator';
import { beginIssueArchive, isIssueArchiveTarget } from './issueArchiveOperation';
import { buildWorkerArchivePrState, deriveIssueArchive } from './issueArchive';
import { resolveSessionIssue } from './resolveIssue';
import { COORDINATOR_PATH } from './useCoordinatorId';

/** Re-read issue membership and lifecycle before each request; never invoke a stop operation. */
export async function archiveIssueSessions(issueKey: string, knownProjectCodes?: ReadonlySet<string>): Promise<readonly string[]> {
    const serverId = getActiveServerSnapshot().serverId;
    const read = () => {
        const state = storage.getState();
        const desk = selectDeskSessions(state);
        const coordinatorId = pickCoordinatorSessionId(desk.list.filter(row => !isIssueArchiveTarget(row.id)).map(row => ({
            id: row.id, path: row.metadata?.path ?? '', active: row.active, archived: Boolean(row.archivedAt), updatedAt: row.updatedAt,
        })), { storedId: getStoredCoordinatorId(), coordinatorPath: COORDINATOR_PATH });
        const sessions = [...desk.list, ...desk.unreadable].filter(row =>
            resolveSessionIssue(row, desk.lookup.get(row.id), state.sessionScmStatus[row.id]?.branch ?? null, knownProjectCodes) === issueKey);
        const now = Date.now();
        const prStates = Object.fromEntries(sessions.map(row => [row.id, buildWorkerArchivePrState(state.getSessionProjectScmSnapshot(row.id), now)]));
        return deriveIssueArchive(issueKey, sessions, prStates, coordinatorId, now);
    };

    const targets = read().archivableSessionIds;
    if (targets.length === 0) return [];
    const finish = beginIssueArchive(issueKey, targets);
    if (!finish) return [];
    try {
        const remaining = new Set(targets);
        while (remaining.size > 0) {
            if (getActiveServerSnapshot().serverId !== serverId) return [...remaining];
            const current = read();
            // Recheck every remaining target before consuming any merged evidence. A resumed,
            // reassigned or newly blocked target has not succeeded, so keep evidence for retry.
            const ineligible = [...remaining].filter(id => !current.archivableSessionIds.includes(id));
            if (ineligible.length > 0) return ineligible;
            // The model orders non-evidence targets first on every recheck.
            const id = current.archivableSessionIds.find(id => remaining.has(id))!;
            try {
                const result = await archiveSessionWithPendingState(id, () => sessionArchiveWithServerScope(id, { serverId }), serverId);
                // A success without an archive timestamp has not established retirement.
                if (result === false || !result.success || !result.archivedAt) return [id];
            } catch {
                // The card reports the failed worker without exposing transport payloads.
                return [id];
            }
            remaining.delete(id);
        }
        return [];
    } finally {
        finish();
    }
}
