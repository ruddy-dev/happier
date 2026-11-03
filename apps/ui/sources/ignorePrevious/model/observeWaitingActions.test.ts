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
