import { extractShellCommand } from '@happier-dev/protocol';

import type { SessionPendingRequest } from '@/sync/domains/session/pending/listPendingSessionRequests';

export type WaitingItem = {
    key: string;
    sessionId: string;
    requestId: string;
    sessionTitle: string;
    tool: string;
    /** Questions (`user_action`) are answered in the session, so they get no Allow/Deny. */
    kind: SessionPendingRequest['kind'];
    /** One line for lists and the coordinator's prompt; cut at 140 characters. */
    summary: string;
    /** What the request will do, in full, for the card someone approves from. */
    detail: string;
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

const MAX_ARGUMENTS_DETAIL = 2000;
const SHELL_WRAPPERS = new Set(['bash', '/bin/bash', 'zsh', '/bin/zsh']);
/** An argument that reads the same whether or not it is joined with spaces. */
const PLAIN_ARGUMENT = /^[^\s'"\\]+$/;

function isStringArray(value: unknown): value is string[] {
    return Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === 'string');
}

/**
 * `extractShellCommand` joins an argument list with spaces, so `['rm', 'my dir']` reads as two
 * arguments. True when any argument list in the request would read differently joined (the
 * script of a `bash -lc` wrapper is shown whole, so it doesn't count).
 */
function hasAmbiguousArgv(args: unknown): boolean {
    let value = args;
    if (typeof value === 'string') {
        try {
            value = JSON.parse(value);
        } catch {
            return false;
        }
    }
    if (isStringArray(value)) {
        const wrapped = value.length >= 3 && SHELL_WRAPPERS.has(value[0]!) && value[1] === '-lc';
        if (wrapped) return value.length > 3;
        return value.some((part) => !PLAIN_ARGUMENT.test(part));
    }
    if (typeof value !== 'object' || value === null) return false;
    const record = value as Record<string, unknown>;
    const toolCall = record.toolCall as Record<string, unknown> | null | undefined;
    return [record.command, record.cmd, record.argv, record.items].some((part) => isStringArray(part) && hasAmbiguousArgv(part))
        || (typeof toolCall === 'object' && toolCall !== null && hasAmbiguousArgv(toolCall.rawInput));
}

function describeArguments(tool: string, args: unknown): string {
    if (args === undefined || args === null) return tool;
    const json = JSON.stringify(args, null, 2) ?? '';
    const out = `${tool} ${json}`;
    return out.length > MAX_ARGUMENTS_DETAIL ? `${out.slice(0, MAX_ARGUMENTS_DETAIL - 1)}…` : out;
}

/**
 * What a request will do, in full, for a card with a one-tap Allow beside it. A shell command
 * (any tool, any of the shapes `extractShellCommand` knows) is shown raw and uncut, env prelude
 * included; an edit shows its file; anything else shows its tool and arguments.
 */
export function describeRequest(tool: string, args: unknown): string {
    if (!hasAmbiguousArgv(args)) {
        const command = extractShellCommand(args);
        if (command) return command;
    }
    const file = FILE_TOOLS.has(tool) ? stringField(args, 'file_path') : null;
    return file ?? describeArguments(tool, args);
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
            kind: request.kind,
            summary: summariseRequest(request.tool, request.arguments),
            detail: describeRequest(request.tool, request.arguments),
            agentNote: stringField(request.arguments, 'description'),
            createdAt: request.createdAt,
        })),
    );
    return items.sort((a, b) => (a.createdAt ?? Infinity) - (b.createdAt ?? Infinity));
}
