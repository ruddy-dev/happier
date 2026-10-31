import type { SessionPendingRequest } from '@/sync/domains/session/pending/listPendingSessionRequests';

export type WaitingItem = {
    key: string;
    sessionId: string;
    requestId: string;
    sessionTitle: string;
    tool: string;
    summary: string;
    /** The agent's own description of the request: a claim, shown labelled as the agent's. */
    agentNote: string | null;
    createdAt: number | null;
};

const MAX_SUMMARY = 140;
const FILE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit']);

function stringField(args: unknown, field: string): string | null {
    if (typeof args !== 'object' || args === null) return null;
    const value = (args as Record<string, unknown>)[field];
    return typeof value === 'string' && value.length > 0 ? value : null;
}

/** One line saying what the request does, from the raw arguments rather than the agent's description. */
export function summariseRequest(tool: string, args: unknown): string {
    const raw = (tool === 'Bash' ? stringField(args, 'command') : FILE_TOOLS.has(tool) ? stringField(args, 'file_path') : null) ?? tool;
    return raw.length > MAX_SUMMARY ? `${raw.slice(0, MAX_SUMMARY - 1)}…` : raw;
}

export function toWaitingItems(
    input: readonly { sessionId: string; sessionTitle: string; requests: readonly SessionPendingRequest[] }[],
): WaitingItem[] {
    const items = input.flatMap(({ sessionId, sessionTitle, requests }) =>
        requests.map((request) => ({
            key: `${sessionId}:${request.id}`,
            sessionId,
            requestId: request.id,
            sessionTitle,
            tool: request.tool,
            summary: summariseRequest(request.tool, request.arguments),
            agentNote: stringField(request.arguments, 'description'),
            createdAt: request.createdAt,
        })),
    );
    return items.sort((a, b) => (a.createdAt ?? Infinity) - (b.createdAt ?? Infinity));
}
