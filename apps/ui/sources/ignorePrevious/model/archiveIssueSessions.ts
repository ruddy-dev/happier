import { archiveSessionWithPendingState } from '@/components/sessions/sessionStopArchiveFlow';
import { getActiveServerSnapshot } from '@/sync/domains/server/serverRuntime';
import { storage } from '@/sync/domains/state/storage';
import { sessionArchiveWithServerScope } from '@/sync/ops/sessions';

import { getStoredCoordinatorId } from '../deskPrefs';
import { selectDeskSessions } from '../useDeskSessions';
import { pickCoordinatorSessionId } from './coordinator';
import { deriveIssueArchive } from './issueArchive';
import { resolveSessionIssue } from './resolveIssue';
import { COORDINATOR_PATH } from './useCoordinatorId';
import { buildWorkerPrBadge } from './workerPrBadge';

/** Re-read issue membership and lifecycle before each request; never invoke a stop operation. */
export async function archiveIssueSessions(issueKey: string, knownProjectCodes?: ReadonlySet<string>): Promise<readonly string[]> {
    const serverId = getActiveServerSnapshot().serverId;
    const read = () => {
        const state = storage.getState();
        const desk = selectDeskSessions(state);
        const coordinatorId = pickCoordinatorSessionId(desk.list.map(row => ({
            id: row.id, path: row.metadata?.path ?? '', active: row.active, archived: Boolean(row.archivedAt), updatedAt: row.updatedAt,
        })), { storedId: getStoredCoordinatorId(), coordinatorPath: COORDINATOR_PATH });
        const sessions = [...desk.list, ...desk.archived, ...desk.unreadable].filter(row =>
            resolveSessionIssue(row, desk.lookup.get(row.id), state.sessionScmStatus[row.id]?.branch ?? null, knownProjectCodes) === issueKey);
        const now = Date.now();
        const prStates = Object.fromEntries(sessions.map(row => [row.id, buildWorkerPrBadge(state.getSessionProjectScmSnapshot(row.id), now)?.state ?? null]));
        return { sessions, model: deriveIssueArchive(issueKey, sessions, prStates, coordinatorId, now) };
    };

    const targets = read().model.archivableSessionIds;
    const failed: string[] = [];
    for (const id of targets) {
        if (getActiveServerSnapshot().serverId !== serverId) {
            failed.push(id);
            continue;
        }
        const current = read();
        const row = current.sessions.find(row => row.id === id);
        // Already archived, resumed, reassigned or selected as coordinator while another request ran.
        if (!row || row.archivedAt || row.active) continue;
        if (!current.model.archivableSessionIds.includes(id)) {
            failed.push(id);
            continue;
        }
        try {
            const result = await archiveSessionWithPendingState(id, () => sessionArchiveWithServerScope(id, { serverId }), serverId);
            // A success without an archive timestamp has not established retirement.
            if (result === false || !result.success || !result.archivedAt) failed.push(id);
        } catch {
            // The card reports exactly which workers failed, without exposing transport payloads.
            failed.push(id);
        }
    }
    return failed;
}
