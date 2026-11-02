import { parsePermissionIntentAlias, resolveAgentIdFromSessionMetadata } from '@happier-dev/agents';
import type { SessionPendingRequest } from '@/sync/domains/session/pending/listPendingSessionRequests';
import type { Session } from '@/sync/domains/state/storageTypes';
import { getPermissionModeOverrideForSpawn } from '@/sync/domains/permissions/permissionModeOverride';
import { summariseRequest } from './waitingItems';

/** Local selection is intent; metadata is the last published mode, not a runtime acknowledgement. */
export function workerPermissionMode(session: Session, outcome: string | null = null) {
    const pending = getPermissionModeOverrideForSpawn(session);
    return {
        current: parsePermissionIntentAlias(session.metadata?.permissionMode ?? ''),
        confirmed: resolveAgentIdFromSessionMetadata(session.metadata) === 'claude' ? outcome : null,
        pending: pending?.permissionMode ?? null,
    };
}

export type ModeChangeRequests = Readonly<{
    mode: string;
    requests: readonly SessionPendingRequest[];
}>;

/** Report completions, never predict approvals or clear requests locally. CLI completions carry mode. */
export function requestsApprovedAfterModeChange(session: Session, change: ModeChangeRequests | null): string[] {
    if (!change || resolveAgentIdFromSessionMetadata(session.metadata) !== 'claude') return [];
    const mode = parsePermissionIntentAlias(change.mode);
    if (mode !== 'safe-yolo' && mode !== 'yolo') return [];
    return change.requests.flatMap((request) => {
        const completed = session.agentState?.completedRequests?.[request.id];
        if (!completed || completed.status !== 'approved' || parsePermissionIntentAlias(completed.mode ?? '') !== mode) return [];
        // These are recorded approvals, not a second auto-approval policy. Interactive requests
        // are never mode-cleared; safe-yolo records only the Claude edit-tool family.
        if (request.kind === 'user_action' || /^(AskUserQuestion|ask_user_question|ExitPlanMode|exit_plan_mode)$/.test(request.tool)) return [];
        if (mode === 'safe-yolo' && !['Edit', 'MultiEdit', 'Write', 'NotebookEdit'].includes(request.tool)) return [];
        return [summariseRequest(request.tool, request.arguments)];
    });
}
