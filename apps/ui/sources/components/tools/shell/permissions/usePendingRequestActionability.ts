import * as React from 'react';
import type { ToolCall } from '@/sync/domains/messages/messageTypes';
import { resolveAgentRequestKind } from '@/utils/sessions/permissions/permissionPromptPolicy';
import { resolvePermissionRequestId } from '@/components/tools/renderers/core/resolvePermissionRequestId';
import { storage } from '@/sync/domains/state/storageStore';
import { createPendingRequestActionabilitySelector } from '@/sync/store/pendingRequestActionability';
import type { SessionPendingRequest } from '@/sync/domains/session/pending/listPendingSessionRequests';

/** A leaf subscription also catches classification changes hidden by retained composer props. */
export function usePendingRequestActionability(sessionId: string | undefined, request: SessionPendingRequest) {
    const selector = React.useMemo(() => createPendingRequestActionabilitySelector(sessionId ?? '', request),
        [sessionId, request.id, request.tool, request.kind, request.arguments, request.createdAt, request.requiresInspection]);
    const actionable = storage(selector);
    const isActionable = React.useCallback(() => selector(storage.getState()), [selector]);
    return { actionable, isActionable };
}

export function pendingRequestFromTool(tool: ToolCall): SessionPendingRequest {
    return {
        id: resolvePermissionRequestId(tool) ?? '',
        tool: tool.name,
        kind: resolveAgentRequestKind({ toolName: tool.name, requestKind: tool.permission?.kind }),
        arguments: tool.input,
        createdAt: tool.createdAt,
        ...(tool.permission?.requiresInspection ? { requiresInspection: true } : {}),
    };
}
