import type { SessionPendingRequest } from '@/sync/domains/session/pending/listPendingSessionRequests';

/** Why you can't answer a request from here, as the session's own footer would say; null when you can. */
export type WaitingDisabledReason = 'readOnly' | 'notGranted' | null;

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
    /** Set for a shared session you may watch but not approve in: the card shows no Allow or Deny. */
    disabledReason: WaitingDisabledReason;
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

const SHELL_WRAPPERS = new Set(['bash', '/bin/bash', 'zsh', '/bin/zsh']);
/**
 * An argument that reads the same joined into shell text as it does in the argument list. An
 * allow-list: anything a shell treats specially (`#`, `;`, `|`, `$`, globs, `~`, quotes, spaces,
 * newlines, any non-ASCII) or an empty argument takes the JSON form instead.
 */
const PLAIN_ARGUMENT = /^[A-Za-z0-9_.\/:=@%+,-]+$/;

function isStringArray(value: unknown): value is string[] {
    return Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === 'string');
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Arguments as the agent sent them, with a JSON-encoded string decoded (some adapters double-encode). */
function parseArguments(args: unknown): unknown {
    if (typeof args !== 'string') return args;
    try {
        return JSON.parse(args);
    } catch {
        return args;
    }
}

/**
 * An argument list as shell text, only where that text reads exactly as what runs: the script of a
 * `bash -lc` wrapper, or arguments that are all plain. Null otherwise, so the caller shows the list itself.
 * A wrapper's arguments after the script become `$0`, `$1`, …, which the script can run: each is
 * listed under it, quoted.
 */
function argvText(argv: readonly string[]): string | null {
    const wrapped = argv.length >= 3 && SHELL_WRAPPERS.has(argv[0]!) && argv[1] === '-lc';
    if (wrapped) {
        const positional = argv.slice(3).map((value, index) => `$${index} = ${JSON.stringify(value)}`);
        return [argv[2]!, ...positional].join('\n');
    }
    return argv.every((part) => PLAIN_ARGUMENT.test(part)) ? argv.join(' ') : null;
}

/** The fields a shell command arrives in, across the agents' shapes (the same ones `extractShellCommand` reads). */
const COMMAND_FIELDS = ['command', 'cmd', 'argv', 'items'] as const;

/**
 * A shell-shaped request: its command as text, and every other field beside it (a working
 * directory, a sandbox or escalation flag), which changes what runs as much as the command does.
 * Null when the request isn't shell-shaped, has more than one command, or its argument list
 * can't be shown as text without changing its meaning.
 */
function readShellRequest(value: unknown): { command: string; rest: Record<string, unknown> } | null {
    if (isStringArray(value)) {
        const command = argvText(value);
        return command === null ? null : { command, rest: {} };
    }
    if (!isRecord(value)) return null;
    const present = COMMAND_FIELDS.filter((field) => value[field] !== undefined);
    if (present.length === 0) {
        // ACP nests the input as { toolCall: { rawInput } }; anything else beside it goes to the JSON form.
        const toolCall = value.toolCall;
        const onlyRawInput = isRecord(toolCall) && Object.keys(value).length === 1 && Object.keys(toolCall).length === 1;
        return onlyRawInput ? readShellRequest(toolCall.rawInput) : null;
    }
    if (present.length > 1) return null;
    const field = present[0]!;
    const raw = value[field];
    const command = typeof raw === 'string' ? (raw.trim().length > 0 ? raw : null) : isStringArray(raw) ? argvText(raw) : null;
    if (command === null) return null;
    const { [field]: _command, ...rest } = value;
    // Shown on the card as the agent's note.
    if (typeof rest.description === 'string') delete rest.description;
    return { command, rest };
}

function describeArguments(tool: string, args: unknown): string {
    if (args === undefined || args === null) return tool;
    // Uncut: no measured cost justifies a cap, and a cap hides the end of what Allow approves.
    return `${tool} ${JSON.stringify(args, null, 2) ?? ''}`;
}

/**
 * What a request will do, in full, for a card with a one-tap Allow beside it. A shell command
 * (any tool, any of the agents' shapes) is shown raw and uncut, env prelude included, followed by
 * every other field it came with; an edit shows its file; anything else shows its tool and arguments.
 */
export function describeRequest(tool: string, args: unknown): string {
    const parsed = parseArguments(args);
    const shell = readShellRequest(parsed);
    if (shell) {
        return Object.keys(shell.rest).length === 0 ? shell.command : `${shell.command}\n${JSON.stringify(shell.rest, null, 2)}`;
    }
    const file = FILE_TOOLS.has(tool) ? stringField(parsed, 'file_path') : null;
    return file ?? describeArguments(tool, parsed);
}

export function toWaitingItems(
    input: readonly {
        sessionId: string;
        sessionTitle: string;
        requests: readonly SessionPendingRequest[];
        disabledReason: WaitingDisabledReason;
    }[],
): WaitingItem[] {
    const items = input.flatMap(({ sessionId, sessionTitle, requests, disabledReason }) =>
        requests.map((request) => ({
            key: `${sessionId}:${request.id}`,
            sessionId,
            requestId: request.id,
            sessionTitle,
            tool: request.tool,
            kind: request.kind,
            summary: summariseRequest(request.tool, request.arguments),
            detail: describeRequest(request.tool, request.arguments),
            agentNote: stringField(parseArguments(request.arguments), 'description'),
            createdAt: request.createdAt,
            disabledReason,
        })),
    );
    return items.sort((a, b) => (a.createdAt ?? Infinity) - (b.createdAt ?? Infinity));
}
