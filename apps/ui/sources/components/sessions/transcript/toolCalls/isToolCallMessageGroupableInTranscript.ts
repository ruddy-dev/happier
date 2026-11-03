import { isAskUserQuestionToolName } from '@happier-dev/protocol';
import { isPendingUserActionRequest } from '@/utils/sessions/permissions/permissionPromptPolicy';
import type { Message, ToolCallMessage } from '@/sync/domains/messages/messageTypes';
import { readTurnChangeToolMetadataFromToolCall } from '@/sync/domains/session/changes/parsing/readTurnChangeToolMetadata';

export function isToolCallMessageGroupableInTranscript(message: Message, keepPendingPermissions = false): message is ToolCallMessage {
    if (message.kind !== 'tool-call') return false;

    if (readTurnChangeToolMetadataFromToolCall(message.tool) != null) {
        return false;
    }

    const permission = message.tool.permission;
    if (keepPendingPermissions && permission?.status === 'pending') return false;
    if (isAskUserQuestionToolName(message.tool.name) && message.tool.state === 'running' && permission?.status == null) return false;
    return !isPendingUserActionRequest({ toolName: message.tool.name, requestKind: permission?.kind, permissionStatus: permission?.status });
}
