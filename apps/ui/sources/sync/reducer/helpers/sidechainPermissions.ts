import { isAgentStateRequestCoveredByCompletedRequests } from '@happier-dev/agents';
import { compareToolCalls } from '../../../utils/tools/toolComparison';
import type { AgentState } from '../../domains/state/storageTypes';
import type { ToolCall } from '../../domains/messages/messageTypes';
import type { ReducerState } from '../reducer';

/** Both main mirrors and nested occurrences project the same producer permission metadata. */
export function getCompletedAllowedTools(completed: unknown): string[] | undefined {
    if (!completed || typeof completed !== 'object') return undefined;
    const record = completed as Record<string, unknown>;
    const list = record.allowedTools ?? record.allowTools;
    if (Array.isArray(list)) return list.filter((tool): tool is string => typeof tool === 'string');
    if (!Array.isArray(record.updatedPermissions)) return undefined;
    const derived = new Set<string>();
    for (const update of record.updatedPermissions) {
        if (!update || typeof update !== 'object') continue;
        const ruleUpdate = update as Record<string, unknown>;
        if (ruleUpdate.type !== 'addRules' || ruleUpdate.behavior !== 'allow' || !Array.isArray(ruleUpdate.rules)) continue;
        for (const rule of ruleUpdate.rules) {
            if (!rule || typeof rule !== 'object') continue;
            const { toolName, ruleContent } = rule as Record<string, unknown>;
            if (typeof toolName !== 'string' || !toolName) continue;
            derived.add(typeof ruleContent === 'string' && ruleContent ? `${toolName}(${ruleContent})` : toolName);
        }
    }
    return derived.size ? [...derived] : undefined;
}

export function permissionPayloadMatches(tool: ToolCall, request: { tool: string; arguments: unknown }): boolean {
    return compareToolCalls({ name: tool.name, arguments: tool.input }, { name: request.tool, arguments: request.arguments });
}

function covered(id: string, tool: ToolCall, completedRequests: NonNullable<AgentState>['completedRequests']) {
    return isAgentStateRequestCoveredByCompletedRequests({ requestId: id,
        request: { tool: tool.name, arguments: tool.input, createdAt: tool.createdAt, kind: tool.permission?.kind }, completedRequests });
}

/** Reconcile only indexed occurrences for producer IDs present in this snapshot. */
export function reconcileSidechainPermissions(state: ReducerState, agentState: AgentState | null | undefined, changed: Set<string>): void {
    for (const [id, request] of Object.entries(agentState?.requests ?? {})) {
        for (const { messageId, sidechainId } of state.sidechainToolIdToMessageId.get(id) ?? []) {
            const tool = state.messages.get(messageId)?.tool;
            if (!tool || tool.permission || !permissionPayloadMatches(tool, request)
                || (typeof request.createdAt === 'number' && tool.createdAt < request.createdAt)) continue;
            tool.permission = { id, status: 'pending', kind: request.kind, suggestions: request.permissionSuggestions };
            const parentId = state.toolIdToMessageId.get(sidechainId);
            if (parentId) changed.add(parentId);
        }
    }
    for (const [id, completion] of Object.entries(agentState?.completedRequests ?? {})) {
        const candidates = (state.sidechainToolIdToMessageId.get(id) ?? []).filter(({ messageId }) => {
            const tool = state.messages.get(messageId)?.tool;
            return tool && (typeof completion.createdAt !== 'number' || tool.createdAt >= completion.createdAt)
                && covered(id, tool, { [id]: completion });
        });
        // One completion cannot safely be assigned to several retained occurrences.
        if (candidates.length > 1) {
            for (const { messageId, sidechainId } of candidates) {
                const tool = state.messages.get(messageId)!.tool!;
                if (tool.permission && tool.permission.status !== 'pending') continue;
                if (tool.permission?.requiresInspection) continue;
                tool.permission = { ...tool.permission, id, status: 'pending', kind: completion.kind, requiresInspection: true };
                const parentId = state.toolIdToMessageId.get(sidechainId);
                if (parentId) changed.add(parentId);
            }
            continue;
        }
        if (candidates.length !== 1) continue;
        const { messageId, sidechainId } = candidates[0];
        const tool = state.messages.get(messageId)!.tool!;
        if (tool.permission && tool.permission.status !== 'pending') continue;
        tool.permission = { id, status: completion.status, kind: completion.kind,
            date: completion.completedAt ?? completion.createdAt ?? undefined,
            reason: completion.reason ?? undefined, decision: completion.decision ?? undefined,
            mode: completion.mode ?? undefined, allowedTools: getCompletedAllowedTools(completion) };
        // Approval resolves the permission, not the tool's execution. Keep its result/lifecycle.
        const parentId = state.toolIdToMessageId.get(sidechainId);
        if (parentId) changed.add(parentId);
    }
}
