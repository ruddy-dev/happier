import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createSessionFixture } from '@/dev/testkit/fixtures/sessionFixtures';
import { storage } from '@/sync/domains/state/storage';
import * as transcriptReader from '@/sync/domains/messages/readStoredSessionMessages';
import * as transcriptAggregate from '@/sync/domains/messages/transcriptRenderableAggregate';
import * as waitingItems from './waitingItems';
import { readDeskWaits } from './useDeskWaits';
import { createWaitingHistory, setWaitingAction } from './waitingHistory';
import { observeWaitingActions } from './observeWaitingActions';
import type { NormalizedMessage } from '@/sync/typesRaw';
import type { TranscriptRequestState } from '@/sync/domains/session/pending/listPendingSessionRequests';

let previous: ReturnType<typeof storage.getState>;
let stop: (() => void) | undefined;
const worker = (version = 1) => createSessionFixture({ id: 'observer-worker', active: true,
    agentStateVersion: version, agentState: { requests: {
        acted: { tool: 'Bash', arguments: { command: 'echo acted' }, createdAt: 1 },
        other: { tool: 'Bash', arguments: { command: 'echo other' }, createdAt: 2 },
    } } });
function write(index: number) {
    storage.getState().applyMessages('observer-worker', [{ id: `text-${index}`, localId: null, createdAt: index + 10,
        role: 'agent', isSidechain: false, content: [{ type: 'text', text: `Token ${index}`, uuid: `text-${index}`, parentUUID: null }] }]);
}
function watch() {
    const item = readDeskWaits().items.find(item => item.requestId === 'acted')!;
    const key = waitingItems.waitingItemGenerationKey(item);
    const history = createWaitingHistory();
    history.setState({ previous: [item] });
    stop = observeWaitingActions(history);
    setWaitingAction(history, key, { phase: 'sent', outcome: 'allowed' });
    return { history, key };
}
beforeEach(() => {
    previous = storage.getState();
    storage.getState().applySessions([]);
    storage.getState().applySessions([worker()]);
    storage.getState().applyReady();
    storage.getState().setSocketStatus('connected');
});
afterEach(() => { stop?.(); stop = undefined; storage.setState(previous, true); vi.restoreAllMocks(); });

it('does no detail builds, transcript reads or request serialization during ten token writes in the acted-on session', () => {
    write(0);
    const { history, key } = watch();
    const details = vi.spyOn(waitingItems, 'toWaitingItems');
    const content = vi.spyOn(waitingItems, 'waitingRequestContent');
    const reads = vi.spyOn(transcriptReader, 'readStoredSessionMessages');
    const stateReads = vi.spyOn(transcriptReader, 'readStoredSessionMessagesFromStateLike');
    const aggregateBuilds = vi.spyOn(transcriptAggregate, 'buildTranscriptRenderableAggregate');
    for (let i = 1; i <= 10; i++) write(i);
    expect(history.getState().actions.get(key)?.phase).toBe('sent');
    expect(details).not.toHaveBeenCalled();
    expect(content).not.toHaveBeenCalled();
    expect(reads).not.toHaveBeenCalled();
    expect(stateReads).not.toHaveBeenCalled();
    expect(aggregateBuilds).not.toHaveBeenCalled();
});

it('ignores a different key disappearing and treats an unloaded record as unknown', () => {
    const { history, key } = watch();
    const next = worker(2);
    delete next.agentState!.requests!.other;
    storage.getState().applySessions([next]);
    expect(history.getState().departed.has(key)).toBe(false);
    const sessions = storage.getState().sessions;
    storage.setState({ sessions: {} });
    expect(history.getState().departed.has(key)).toBe(false);
    storage.setState({ sessions });
    expect(history.getState().actions.get(key)?.phase).toBe('sent');
});

it.each(['account', 'server'] as const)('retires outstanding feedback on a %s change without a mounted panel', change => {
    const scope = { accountId: 'a', serverId: 'a' };
    storage.setState({ profileScope: scope });
    const { history } = watch();
    storage.setState({ profileScope: { ...scope, [change === 'account' ? 'accountId' : 'serverId']: 'b' } });
    expect(history.getState().actions.size).toBe(0);
    expect(history.getState().departed.size).toBe(0);
});

it.each([null, {}])('observes a transcript-only request departing with agentState %j', agentState => {
    storage.getState().applySessions([createSessionFixture({ id: 'observer-worker', active: true,
        agentStateVersion: 2, agentState })]);
    const pending: NormalizedMessage = {
        id: 'tool', localId: null, createdAt: 1, role: 'agent', isSidechain: false,
        content: [{ type: 'tool-call', id: 'acted', name: 'bash',
            input: { permissionId: 'acted', status: 'pending', command: 'echo acted' },
            description: null, uuid: 'tool', parentUUID: null }],
    };
    storage.getState().applyMessages('observer-worker', [pending]);
    const { history, key } = watch();
    expect(history.getState().departed.has(key)).toBe(false);
    storage.getState().applyMessages('observer-worker', [{
        id: 'result', localId: null, createdAt: 2, role: 'agent', isSidechain: false,
        content: [{ type: 'tool-result', tool_use_id: 'acted', content: 'done', is_error: false,
            permissions: { result: 'approved', date: 2 }, uuid: 'result', parentUUID: null }],
    }]);
    expect(readDeskWaits().items.some(item => item.requestId === 'acted')).toBe(false);
    expect(history.getState().departed.has(key)).toBe(true);
});

function transcriptRequest(createdAt = 1): NormalizedMessage {
    return { id: `tool-${createdAt}`, localId: null, createdAt, role: 'agent', isSidechain: false,
        content: [{ type: 'tool-call', id: 'acted', name: 'bash',
            input: { permissionId: 'acted', status: 'pending', command: 'echo acted' },
            description: null, uuid: `tool-${createdAt}`, parentUUID: null }] };
}
function seedTranscriptOnly() {
    storage.getState().applySessions([createSessionFixture({ id: 'observer-worker', active: true,
        agentStateVersion: 2, agentState: null, pendingPermissionRequestCount: 1 })]);
    storage.getState().applyMessages('observer-worker', [transcriptRequest()]);
    storage.getState().applyMessagesLoaded('observer-worker');
}
function terminalTranscript() {
    storage.getState().applyMessages('observer-worker', [{
        id: 'result', localId: null, createdAt: 2, role: 'agent', isSidechain: false,
        content: [{ type: 'tool-result', tool_use_id: 'acted', content: 'done', is_error: false,
            permissions: { result: 'approved', date: 2 }, uuid: 'result', parentUUID: null }],
    }]);
}

it.each([false, true])('observes a zero-count closed-drawer gap with a missing aggregate, loaded=%s', loaded => {
    seedTranscriptOnly();
    const { history, key } = watch();
    storage.getState().resetSessionMessages('observer-worker');
    if (loaded) storage.getState().applyMessagesLoaded('observer-worker');
    const current = storage.getState().sessions['observer-worker'];
    storage.getState().applySessions([{ ...current, agentState: null,
        pendingPermissionRequestCount: 0, pendingUserActionRequestCount: 0 }]);
    expect(storage.getState().sessionListRenderables['observer-worker'].hasPendingPermissionRequests).toBe(false);
    expect(history.getState().departed.has(key)).toBe(true);
    storage.getState().applySessions([{ ...current, agentState: null,
        pendingPermissionRequestCount: 1, pendingUserActionRequestCount: 0 }]);
    storage.getState().applyMessages('observer-worker', [transcriptRequest()]);
    expect(waitingItems.waitingItemGenerationKey(readDeskWaits().items[0])).toBe(key);
    expect(history.getState().actions.has(key)).toBe(false);
});

it('observes a zero projection and identical reopen while the closed drawer retains its pending transcript', () => {
    seedTranscriptOnly();
    const { history, key } = watch();
    const current = storage.getState().sessions['observer-worker'];
    storage.getState().applySessions([{ ...current, pendingPermissionRequestCount: 0,
        pendingUserActionRequestCount: 0 }]);
    expect(storage.getState().sessionListRenderables['observer-worker'].hasPendingPermissionRequests).toBe(false);
    expect(history.getState().departed.has(key)).toBe(true);
    storage.getState().applySessions([{ ...current, pendingPermissionRequestCount: 1,
        pendingUserActionRequestCount: 0 }]);
    expect(history.getState().actions.has(key)).toBe(false);
});

it.each([undefined, 1])('keeps a missing partial aggregate unknown with projected permission count %s', count => {
    seedTranscriptOnly();
    const { history, key } = watch();
    storage.getState().resetSessionMessages('observer-worker');
    const current = storage.getState().sessions['observer-worker'];
    storage.getState().applySessions([{ ...current, agentState: null,
        pendingPermissionRequestCount: count, pendingUserActionRequestCount: count === undefined ? undefined : 0 }]);
    expect(history.getState().departed.has(key)).toBe(false);
    storage.getState().applySessions([{ ...current, agentState: null, pendingPermissionRequestCount: 1 }]);
    storage.getState().applyMessages('observer-worker', [transcriptRequest()]);
    expect(history.getState().actions.has(key)).toBe(true);
});

it.each(['one missing count', 'conflicting live request'] as const)('does not turn %s into a proved empty projection', boundary => {
    seedTranscriptOnly();
    const { history, key } = watch();
    storage.getState().resetSessionMessages('observer-worker');
    const current = storage.getState().sessions['observer-worker'];
    storage.getState().applySessions([{ ...current, agentStateVersion: current.agentStateVersion + 1,
        agentState: boundary === 'conflicting live request' ? { requests: {
            acted: { tool: 'Bash', arguments: { command: 'echo acted' }, createdAt: 1 },
        } } : null,
        pendingPermissionRequestCount: 0,
        pendingUserActionRequestCount: boundary === 'one missing count' ? undefined : 0 }]);
    expect(history.getState().departed.has(key)).toBe(false);
});

it.each(['sent', 'unavailable', 'sending'] as const)('retires loaded transcript-only %s feedback after a terminal observation despite a positive count', phase => {
    seedTranscriptOnly();
    const { history, key } = watch();
    setWaitingAction(history, key, phase === 'sent' ? { phase, outcome: 'allowed' }
        : phase === 'unavailable' ? { phase, outcome: 'unavailable' } : { phase });
    terminalTranscript();
    expect(storage.getState().sessionMessages['observer-worker'].isLoaded).toBe(true);
    expect(storage.getState().sessions['observer-worker'].pendingPermissionRequestCount).toBe(1);
    expect(storage.getState().sessionMessages['observer-worker'].renderableAggregate?.requestStates.get('acted')?.status).toBe('terminal');
    expect(history.getState().departed.has(key)).toBe(true);
    // A transcript refresh can return the same opaque ID, raw payload and timestamp.
    storage.getState().resetSessionMessages('observer-worker');
    storage.getState().applyMessages('observer-worker', [transcriptRequest()]);
    storage.getState().applyMessagesLoaded('observer-worker');
    expect(waitingItems.waitingItemGenerationKey(readDeskWaits().items[0])).toBe(key);
    expect(history.getState().actions.has(key)).toBe(phase === 'sending');
    expect(history.getState().departed.has(key)).toBe(phase === 'sending');
    if (phase === 'sending') expect(history.getState().actions.get(key)).toMatchObject({ contentsChanged: true });
});

it('bounds watched-ID work independently of a 10,000-entry historical aggregate', () => {
    write(0);
    const { history, key } = watch();
    const entry = storage.getState().sessionMessages['observer-worker'];
    const aggregate = entry.renderableAggregate!;
    const states = new Map<string, TranscriptRequestState>();
    for (let i = 0; i < 10_000; i++) states.set(`old-${i}`, { status: 'terminal', terminalKind: 'hard', createdAt: i });
    states.set('acted', { status: 'terminal', terminalKind: 'hard', createdAt: 20_000 });
    // Trap every traversal API, but allow the producer-owned per-ID lookup. Install after seeding
    // so this measures the closed observer rather than the store's aggregate rebuild.
    const traversal = () => { throw new Error('historical request traversal'); };
    const get = vi.spyOn(states, 'get');
    vi.spyOn(states, 'values').mockImplementation(traversal);
    vi.spyOn(states, 'entries').mockImplementation(traversal);
    vi.spyOn(states, 'keys').mockImplementation(traversal);
    vi.spyOn(states, 'forEach').mockImplementation(traversal);
    vi.spyOn(states, Symbol.iterator).mockImplementation(traversal);
    storage.setState({ sessionMessages: { ...storage.getState().sessionMessages,
        'observer-worker': { ...entry, renderableAggregate: { ...aggregate, requestStates: states } } } });
    expect(history.getState().departed.has(key)).toBe(true);
    expect(get.mock.calls.length).toBeLessThanOrEqual(2);
    expect(get.mock.calls.every(([id]) => id === 'acted')).toBe(true);
});


it.each([false, true])('preserves a positive-count placeholder when transcript absence is partial/loaded=%s', loaded => {
    seedTranscriptOnly();
    const { history, key } = watch();
    const entry = storage.getState().sessionMessages['observer-worker'];
    storage.setState({ sessionMessages: { ...storage.getState().sessionMessages, 'observer-worker': {
        ...entry, isLoaded: loaded, renderableAggregate: { ...entry.renderableAggregate!, requestStates: new Map() },
    } } });
    expect(history.getState().departed.has(key)).toBe(false);
    expect(history.getState().actions.get(key)?.phase).toBe('sent');
});

it('does not infer departure from partial absence even without projected counts', () => {
    seedTranscriptOnly();
    const { history, key } = watch();
    const entry = storage.getState().sessionMessages['observer-worker'];
    storage.setState({ sessions: { ...storage.getState().sessions, 'observer-worker': {
        ...storage.getState().sessions['observer-worker'], pendingPermissionRequestCount: undefined,
    } }, sessionMessages: { ...storage.getState().sessionMessages, 'observer-worker': {
        ...entry, isLoaded: false, renderableAggregate: { ...entry.renderableAggregate!, requestStates: new Map() },
    } } });
    expect(history.getState().departed.has(key)).toBe(false);
});

it.each(['missing session', 'unreadable metadata', 'stale aggregate', 'disconnected', 'not ready'] as const)('keeps an action through %s until its terminal evidence is readable', boundary => {
    seedTranscriptOnly();
    const { history, key } = watch();
    const state = storage.getState();
    const entry = state.sessionMessages['observer-worker'];
    const terminal = new Map<string, TranscriptRequestState>([['acted', { status: 'terminal', terminalKind: 'hard', createdAt: 2 }]]);
    const sessionMessages = { ...state.sessionMessages, 'observer-worker': { ...entry,
        renderableAggregate: { ...entry.renderableAggregate!, requestStates: terminal } } };
    storage.setState({ sessionMessages,
        ...(boundary === 'missing session' ? { sessions: {} } : {}),
        ...(boundary === 'unreadable metadata' ? { sessionListRenderables: { ...state.sessionListRenderables,
            'observer-worker': { ...state.sessionListRenderables['observer-worker'], metadataUnavailable: true } } } : {}),
        ...(boundary === 'stale aggregate' ? { sessions: { ...state.sessions, 'observer-worker': { ...state.sessions['observer-worker'],
            agentState: { completedRequests: {} } } } } : {}),
        ...(boundary === 'disconnected' ? { socketStatus: 'disconnected' as const } : {}),
        ...(boundary === 'not ready' ? { isDataReady: false } : {}),
    });
    expect(history.getState().departed.has(key)).toBe(false);
    storage.setState({ sessions: state.sessions, sessionListRenderables: state.sessionListRenderables,
        socketStatus: 'connected', isDataReady: true });
    expect(history.getState().departed.has(key)).toBe(true);
});

it('keeps transcript metadata for equivalent same-ID agent details, then retires changed agent content', () => {
    seedTranscriptOnly();
    const { history, key } = watch();
    const request = storage.getState().sessionMessages['observer-worker'].renderableAggregate!.requestStates.get('acted')!;
    if (request.status !== 'pending') throw new Error('expected pending');
    storage.getState().applySessions([createSessionFixture({ id: 'observer-worker', active: true, agentStateVersion: 3,
        pendingPermissionRequestCount: 1, agentState: { requests: { acted: {
            tool: request.request.tool, arguments: request.request.arguments, createdAt: 10,
        } } } })]);
    expect(history.getState().actions.get(key)?.phase).toBe('sent'); // Equivalent transcript timestamp wins.
    expect(history.getState().departed.has(key)).toBe(false);
    storage.getState().applySessions([createSessionFixture({ id: 'observer-worker', active: true, agentStateVersion: 4,
        pendingPermissionRequestCount: 1, agentState: { requests: { acted: {
            tool: 'Bash', arguments: { command: 'different command' }, createdAt: 20,
        } } } })]);
    expect(history.getState().actions.has(key)).toBe(false); // Non-equivalent same-ID agent details win.
});

it.each(['hard', 'soft_interrupted'] as const)('a %s transcript terminal cannot retire a newer live agent request', terminalKind => {
    write(0);
    const { history, key } = watch();
    const entry = storage.getState().sessionMessages['observer-worker'];
    storage.setState({ sessionMessages: { ...storage.getState().sessionMessages, 'observer-worker': { ...entry,
        renderableAggregate: { ...entry.renderableAggregate!, requestStates: new Map([
            ['acted', { status: 'terminal', terminalKind, createdAt: terminalKind === 'hard' ? 0 : 10 }],
        ]) },
    } } });
    expect(history.getState().departed.has(key)).toBe(false);
    expect(history.getState().actions.get(key)?.phase).toBe('sent');
});


it('recognizes loaded absence once projected counts reach zero', () => {
    seedTranscriptOnly();
    const { history, key } = watch();
    const entry = storage.getState().sessionMessages['observer-worker'];
    storage.setState({ sessions: { ...storage.getState().sessions, 'observer-worker': {
        ...storage.getState().sessions['observer-worker'], pendingPermissionRequestCount: 0,
    } }, sessionMessages: { ...storage.getState().sessionMessages, 'observer-worker': {
        ...entry, renderableAggregate: { ...entry.renderableAggregate!, requestStates: new Map() },
    } } });
    expect(history.getState().departed.has(key)).toBe(true);
});

it.each([false, true])('uses canonical same-ID completion equivalence, matched=%s, despite a positive count', matched => {
    // No transcript entry: snapshot reconciliation would synthesize an independent hard
    // terminal for this ID, obscuring the completion-coverage decision under test.
    expect(storage.getState().sessionMessages['observer-worker']).toBeUndefined();
    const { history, key } = watch();
    const next = worker(2);
    next.pendingPermissionRequestCount = 1;
    next.agentState!.completedRequests = { acted: { tool: 'Bash', arguments: {
        command: matched ? 'echo acted' : 'different command',
    }, createdAt: 1, completedAt: 2, status: 'approved' } };
    storage.getState().applySessions([next]);
    expect(storage.getState().sessionMessages['observer-worker']).toBeUndefined();
    expect(history.getState().departed.has(key)).toBe(matched);
    expect(history.getState().actions.get(key)?.phase).toBe('sent');
});

it.each(['matching', 'different payload', 'older completion', 'later occurrence'] as const)(
    'observes a removed target with an independent positive count only for matching occurrence evidence: %s', evidence => {
        const original = worker(2);
        original.pendingPermissionRequestCount = 2;
        original.pendingUserActionRequestCount = 0;
        if (evidence === 'later occurrence') original.agentState!.requests!.acted.createdAt = 3;
        storage.getState().applySessions([original]);
        const { history, key } = watch();
        setWaitingAction(history, key, { phase: 'sending' });
        storage.getState().applySessions([{ ...original, agentStateVersion: 3,
            pendingPermissionRequestCount: 1, agentState: {
                requests: { other: original.agentState!.requests!.other },
                completedRequests: { acted: { tool: 'Bash',
                    arguments: { command: evidence === 'different payload' ? 'different command' : 'echo acted' },
                    createdAt: evidence === 'older completion' ? 0 : 1,
                    completedAt: evidence === 'older completion' ? 0 : 2, status: 'denied' } },
            } }]);
        expect(storage.getState().sessionMessages['observer-worker']).toBeUndefined();
        expect(readDeskWaits().items.map(item => item.requestId)).toEqual(['other']);
        expect(history.getState().departed.has(key)).toBe(evidence === 'matching');
        expect(history.getState().actions.get(key)?.phase).toBe('sending');
    },
);


it('keeps positive-count soft interruption unknown when no live agent details are readable', () => {
    seedTranscriptOnly();
    const { history, key } = watch();
    const entry = storage.getState().sessionMessages['observer-worker'];
    storage.setState({ sessionMessages: { ...storage.getState().sessionMessages, 'observer-worker': { ...entry,
        renderableAggregate: { ...entry.renderableAggregate!, requestStates: new Map([
            ['acted', { status: 'terminal', terminalKind: 'soft_interrupted', createdAt: 2 }],
        ]) },
    } } });
    expect(history.getState().departed.has(key)).toBe(false);
    expect(history.getState().actions.get(key)?.phase).toBe('sent');
});
