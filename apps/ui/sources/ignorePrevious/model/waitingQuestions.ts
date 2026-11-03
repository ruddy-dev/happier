import { isClaudeUnifiedTerminalDialogChoiceAgentStateRequest } from '@happier-dev/agents';
import { normalizeAskUserQuestionRenderQuestions } from '@/components/tools/renderers/workflow/buildAskUserQuestionAnswerPayload';
import type { AgentState } from '@/sync/domains/state/storageTypes';
import { resolveAgentRequestKind } from '@/utils/sessions/permissions/permissionPromptPolicy';

/** The desk's ordinary-question boundary, shared by render and send-time validation. */
export function resolveWaitingQuestions(request: NonNullable<AgentState['requests']>[string] | undefined) {
    if (request?.tool !== 'AskUserQuestion'
        || resolveAgentRequestKind({ toolName: request.tool, requestKind: request.kind }) !== 'user_action'
        || isClaudeUnifiedTerminalDialogChoiceAgentStateRequest(request)) return null;
    const input: unknown = request.arguments;
    if (input && typeof input === 'object' && 'happierDialog' in input) return null;
    const normalized = normalizeAskUserQuestionRenderQuestions(input);
    return normalized.ok ? normalized.questions : null;
}
