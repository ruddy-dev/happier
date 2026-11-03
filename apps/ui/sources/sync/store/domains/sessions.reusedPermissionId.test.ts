import { afterEach, beforeEach, expect, it } from 'vitest';
import { createSessionFixture } from '@/dev/testkit/fixtures/sessionFixtures';
import { storage } from '@/sync/domains/state/storage';
import type { AgentState } from '@/sync/domains/state/storageTypes';
import type { NormalizedMessage } from '@/sync/typesRaw';
import { listPendingPermissionRequests } from '@/utils/sessions/sessionUtils';
import { listPendingSessionRequests, observePendingSessionRequest } from '@/sync/domains/session/pending/listPendingSessionRequests';
import { readDeskWaits } from '@/ignorePrevious/model/useDeskWaits';
import { applyMessageChangeToTranscriptRenderableAggregate, buildTranscriptRenderableAggregate } from '@/sync/domains/messages/transcriptRenderableAggregate';
import { createPendingRequestActionabilitySelector } from '@/sync/store/pendingRequestActionability';

let previous: ReturnType<typeof storage.getState>;
beforeEach(() => { previous = storage.getState(); storage.setState({ sessions: {}, sessionMessages: {}, sessionListRenderables: {} }); });
afterEach(() => storage.setState(previous, true));
const request = (command: string, createdAt: number) => ({ tool: 'Bash', arguments: { command }, createdAt });
function call(id: string, name: string, input: unknown, at: number, sidechainId?: string): NormalizedMessage {
    return { id: `message-${id}-${at}-${sidechainId ?? 'main'}`, localId: null, createdAt: at,
        role: 'agent', isSidechain: !!sidechainId, ...(sidechainId ? { sidechainId } : {}),
        content: [{ type: 'tool-call', id, name, input, description: null, uuid: `call-${at}`, parentUUID: null }] };
}
function snapshot(id: string, agentState: AgentState) {
    const session = storage.getState().sessions[id];
    storage.getState().applySessions([{ ...session, agentStateVersion: session.agentStateVersion + 1, agentState }]);
}
function roots(id: string) {
    const entry = storage.getState().sessionMessages[id];
    return entry.messageIdsOldestFirst.map(key => entry.messagesById[key]);
}
function children(id: string) {
    return roots(id).flatMap(root => root.kind === 'tool-call' ? root.children : []);
}
function assertReaders(id: string, commands: string[]) {
    // A public message refresh rebuilds an invalidated partial aggregate (the lead's base fix).
    storage.getState().applyMessages(id, []);
    const session = storage.getState().sessions[id];
    const entry = storage.getState().sessionMessages[id];
    for (const messages of [roots(id), roots(id).reverse()]) {
        const full = buildTranscriptRenderableAggregate({ messages, completedRequests: session.agentState?.completedRequests ?? null });
        for (const pending of [listPendingPermissionRequests(session, messages), listPendingSessionRequests(session, [], { states: full.requestStates }),
            listPendingSessionRequests(session, [], { states: entry.renderableAggregate!.requestStates })]) {
            expect(pending.map(req => req.arguments)).toEqual(commands.map(command => ({ command })));
        }
        expect(observePendingSessionRequest(session, 'r', full.requestStates.get('r')).status).toBe(commands.length ? 'pending' : 'terminal');
    }
    storage.getState().applyReady();
    expect(readDeskWaits().items.filter(item => item.sessionId === id).map(item => item.detail)).toEqual(commands);
    expect(storage.getState().sessionListRenderables[id].hasPendingPermissionRequests).toBe(commands.length > 0);
}

it.each([['task-a', 'task-b'], ['task-b', 'task-a']])(
    'equal-time hard completions guard old A through real store, roots %s then %s', (first, second) => {
        const id = 'tied-completions';
        storage.getState().applySessions([createSessionFixture({ id, active: true, agentState: { requests: { r: request('echo A', 200) } } })]);
        storage.getState().applyMessages(id, [call(first, 'Task', {}, 250), call(second, 'Task', {}, 250),
            call('r', 'Bash', { command: 'echo A' }, 300, 'task-a')]);
        snapshot(id, { requests: {}, completedRequests: { r: { ...request('echo A', 200), completedAt: 400, status: 'approved' } } });
        snapshot(id, { requests: { r: request('echo B', 200) } });
        storage.getState().applyMessages(id, [call('r', 'Bash', { command: 'echo B' }, 300, 'task-b')]);
        snapshot(id, { requests: {}, completedRequests: { r: { ...request('echo B', 200), completedAt: 400, status: 'approved' } } });
        expect(children(id).filter(child => child.kind === 'tool-call').map(child => ({ at: child.createdAt, tool: child.tool })))
            .toEqual(expect.arrayContaining(['echo A', 'echo B'].map(command => expect.objectContaining({ at: 300,
                tool: expect.objectContaining({ input: { command }, permission: expect.objectContaining({ status: 'approved' }) }) }))));
        storage.getState().applyMessagesLoaded(id);
        snapshot(id, { requests: { r: request('echo A', 100), q: request('echo independent', 700) } });
        const session = storage.getState().sessions[id];
        const entry = storage.getState().sessionMessages[id];
        const observations = [roots(id), roots(id).reverse()].map(messages => {
            const full = buildTranscriptRenderableAggregate({ messages, completedRequests: null });
            const streamed = buildTranscriptRenderableAggregate({ messages: [], completedRequests: null });
            for (const message of messages) expect(applyMessageChangeToTranscriptRenderableAggregate({ aggregate: streamed, previous: null, next: message })).toBe(true);
            return { rootIds: messages.map(message => message.id), direct: listPendingSessionRequests(session, messages),
                full: listPendingSessionRequests(session, [], { states: full.requestStates }),
                streamed: listPendingSessionRequests(session, [], { states: streamed.requestStates }),
                targeted: observePendingSessionRequest(session, 'r', full.requestStates.get('r')) };
        });
        const incremental = listPendingSessionRequests(session, [], { states: entry.renderableAggregate!.requestStates });
        for (const pending of [...observations.flatMap(value => [value.direct, value.full, value.streamed]), incremental]) {
            const stale = pending.find(value => value.id === 'r');
            expect.soft(!stale || stale.requiresInspection === true).toBe(true);
            expect(pending.find(value => value.id === 'q')).toMatchObject({ arguments: { command: 'echo independent' } });
            expect(pending.find(value => value.id === 'q')).not.toHaveProperty('requiresInspection');
        }
        for (const { targeted } of observations) {
            expect.soft(targeted.status !== 'pending' || targeted.request.requiresInspection === true).toBe(true);
        }
        const displayed = { id: 'r', kind: 'permission' as const, ...request('echo A', 100) };
        expect.soft(createPendingRequestActionabilitySelector(id, displayed)(storage.getState())).toBe(false);

        // A different current payload must not inherit A or B's outcome. With no
        // later clock, the collision allows inspection only, not an arbitrary answer.
        snapshot(id, { requests: { r: request('echo C', 300), q: request('echo independent', 700) } });
        const changedSession = storage.getState().sessions[id];
        for (const states of [storage.getState().sessionMessages[id].renderableAggregate!.requestStates,
            buildTranscriptRenderableAggregate({ messages: roots(id), completedRequests: null }).requestStates]) {
            expect(listPendingSessionRequests(changedSession, [], { states }).find(value => value.id === 'r'))
                .toMatchObject({ arguments: { command: 'echo C' }, requiresInspection: true });
            expect(observePendingSessionRequest(changedSession, 'r', states.get('r')))
                .toMatchObject({ status: 'pending', request: { arguments: { command: 'echo C' }, requiresInspection: true } });
        }
        // A real later reopen disambiguates the current publication. Retraction of
        // its soft interruption must retain the older hard collision in both readers.
        snapshot(id, { requests: { r: request('echo A', 500), q: request('echo independent', 700) } });
        for (const phase of ['reopen', 'resume']) {
            if (phase === 'resume') {
                snapshot(id, { requests: { q: request('echo independent', 700) }, completedRequests: {
                    r: { ...request('echo A', 500), completedAt: 600, status: 'canceled', reason: 'Request interrupted' },
                } });
                snapshot(id, { requests: { r: request('echo A', 500), q: request('echo independent', 700) } });
            }
            const current = storage.getState().sessions[id];
            const currentEntry = storage.getState().sessionMessages[id];
            const full = buildTranscriptRenderableAggregate({ messages: roots(id), completedRequests: null });
            expect(currentEntry.renderableAggregate!.requestStates.get('r')).toEqual(full.requestStates.get('r'));
            for (const states of [full.requestStates, currentEntry.renderableAggregate!.requestStates]) {
                const pending = listPendingSessionRequests(current, [], { states });
                expect(pending.find(value => value.id === 'r')).toMatchObject({ createdAt: 500, arguments: { command: 'echo A' } });
                expect(pending.find(value => value.id === 'r')).not.toHaveProperty('requiresInspection');
                expect(observePendingSessionRequest(current, 'r', states.get('r'))).toMatchObject({ status: 'pending', request: { createdAt: 500 } });
            }
            expect(createPendingRequestActionabilitySelector(id, { ...displayed, createdAt: 500 })(storage.getState())).toBe(true);
        }
        snapshot(id, { requests: { q: request('echo independent', 700) }, completedRequests: {
            r: { ...request('echo A', 500), completedAt: 800, status: 'approved' },
        } });
        // A reused mirror keeps its enclosing transcript clock. Supply a genuine
        // later transcript occurrence before expecting the hard watermark to advance.
        storage.getState().applyMessages(id, [call('later-task', 'Task', {}, 650),
            call('r', 'Bash', { command: 'echo A' }, 700, 'later-task')]);
        const completedSession = storage.getState().sessions[id];
        for (const states of [storage.getState().sessionMessages[id].renderableAggregate!.requestStates,
            buildTranscriptRenderableAggregate({ messages: roots(id), completedRequests: null }).requestStates]) {
            expect(states.get('r')).not.toHaveProperty('hardTerminalAmbiguous');
            expect(listPendingSessionRequests(completedSession, [], { states }).map(value => value.id)).toEqual(['q']);
            expect(observePendingSessionRequest(completedSession, 'r', states.get('r')).status).toBe('terminal');
        }
    });

it('retracts changed equal-time hard payload evidence instead of declaring it interchangeable', () => {
    const id = 'hard-retraction';
    storage.getState().applySessions([createSessionFixture({ id, active: true, agentState: { requests: { r: request('echo A', 200) } } })]);
    storage.getState().applyMessages(id, [call('task', 'Task', {}, 250), call('r', 'Bash', { command: 'echo A' }, 300, 'task')]);
    snapshot(id, { requests: {}, completedRequests: { r: { ...request('echo A', 200), completedAt: 400, status: 'approved' } } });
    const original = roots(id).find(root => root.kind === 'tool-call' && root.tool.name === 'Task');
    if (original?.kind !== 'tool-call' || original.children[0]?.kind !== 'tool-call') throw new Error('missing completed child');
    const child = original.children[0];
    const changed = { ...original, children: [{ ...child, tool: { ...child.tool, input: { command: 'echo B' } } }] };
    const aggregate = buildTranscriptRenderableAggregate({ messages: [original], completedRequests: null });
    expect.soft(applyMessageChangeToTranscriptRenderableAggregate({ aggregate, previous: original, next: changed })).toBe(false);
    const sole = buildTranscriptRenderableAggregate({ messages: [original], completedRequests: null });
    expect(applyMessageChangeToTranscriptRenderableAggregate({ aggregate: sole, previous: original, next: changed,
        isSoleRequestStateContributor: () => true })).toBe(true);
    expect(sole.requestStates).toEqual(buildTranscriptRenderableAggregate({ messages: [changed], completedRequests: null }).requestStates);
});

it.each(['existing child', 'completion before child', 'batched parent and child', 'reversed batch'])(
    'materializes live matching completion on nested B: %s', order => {
        const id = 'live';
        storage.getState().applySessions([createSessionFixture({ id, active: true, agentState: { requests: { r: request('echo B', 200) } } })]);
        const parent = call('task', 'Task', { prompt: 'Nested work' }, 250);
        const child = call('r', 'Bash', { command: 'echo B' }, 300, 'task');
        if (order === 'existing child') storage.getState().applyMessages(id, [parent, child]);
        snapshot(id, { requests: {}, completedRequests: { r: { ...request('echo B', 200), completedAt: 400, status: 'approved' } } });
        if (order === 'completion before child') { storage.getState().applyMessages(id, [parent]); storage.getState().applyMessages(id, [child]); }
        if (order === 'batched parent and child') storage.getState().applyMessages(id, [parent, child]);
        if (order === 'reversed batch') storage.getState().applyMessages(id, [child, parent]);
        expect(children(id)).toMatchObject([{ tool: { permission: { status: 'approved' }, state: 'running', result: undefined, completedAt: null } }]);
        storage.getState().applyMessagesLoaded(id);
        snapshot(id, { requests: { r: request('echo A', 500) }, completedRequests: {} });
        assertReaders(id, ['echo A']);
        snapshot(id, { requests: {}, completedRequests: { r: { ...request('echo A', 500), completedAt: 600, status: 'approved' } } });
        assertReaders(id, []);
        expect(children(id)).toMatchObject([{ tool: { permission: { status: 'approved' } } }]);
    });

it.each([false, true])('keeps current different-payload request actionable, equal timestamps=%s', equal => {
    const id = 'equal';
    const at = equal ? 300 : 500;
    storage.getState().applySessions([createSessionFixture({ id, active: true, agentState: { requests: { r: request('echo B', 200) } } })]);
    storage.getState().applyMessages(id, [call('task', 'Task', {}, 250), call('r', 'Bash', { command: 'echo B' }, 300, 'task')]);
    snapshot(id, { requests: { r: request('echo A', at) }, completedRequests: { r: { ...request('echo B', 200), completedAt: 400, status: 'approved' } } });
    assertReaders(id, ['echo A']);
    const mirror = roots(id).find(root => root.kind === 'tool-call' && root.tool.name === 'Bash');
    expect(mirror).toMatchObject({ tool: { permission: { status: 'pending' } } });
});

it('preserves same-payload later reopen and does not complete unrelated same-ID children', () => {
    const id = 'reopen';
    storage.getState().applySessions([createSessionFixture({ id, active: true, agentState: { requests: { r: request('echo B', 200) } } })]);
    storage.getState().applyMessages(id, [call('task', 'Task', {}, 250), call('other', 'Task', {}, 251),
        call('r', 'Bash', { command: 'echo B' }, 300, 'task'), call('r', 'Bash', { command: 'echo unrelated' }, 301, 'other')]);
    const unrelated = children(id).find(child => child.kind === 'tool-call' && child.tool.input.command === 'echo unrelated');
    snapshot(id, { requests: {}, completedRequests: { r: { ...request('echo B', 200), completedAt: 400, status: 'approved' } } });
    storage.getState().applyMessages(id, [call('r', 'Bash', { command: 'echo B' }, 500, 'task')]);
    snapshot(id, { requests: { r: request('echo B', 500) }, completedRequests: { r: { ...request('echo B', 200), completedAt: 400, status: 'approved' } } });
    expect(children(id).map(child => child.kind === 'tool-call' ? child.tool.permission?.status : null)).toEqual(['approved', 'pending', 'pending']);
    assertReaders(id, ['echo B']);
    expect(listPendingSessionRequests(storage.getState().sessions[id])).not.toContainEqual(expect.objectContaining({ requiresInspection: true }));
    snapshot(id, { requests: {}, completedRequests: { r: { ...request('echo B', 500), completedAt: 600, status: 'approved' } } });
    expect(children(id).map(child => child.kind === 'tool-call' ? child.tool.permission?.status : null)).toEqual(['approved', 'approved', 'pending']);
    assertReaders(id, []);
    expect(children(id).find(child => child.id === unrelated?.id)).toEqual(unrelated);
    snapshot(id, { requests: {}, completedRequests: { r: { ...request('echo A', 700), completedAt: 800, status: 'approved' } } });
    assertReaders(id, []);
});

it('cold conflicting completion retains possibly unanswered B for inspection and keeps independent request actionable', () => {
    const id = 'cold';
    storage.getState().applySessions([createSessionFixture({ id, active: true, agentState: { requests: { r: request('echo B', 200) } } })]);
    storage.getState().applyMessages(id, [call('task', 'Task', {}, 250), call('r', 'Bash', { command: 'echo B' }, 300, 'task')]);
    snapshot(id, { requests: { independent: request('echo independent', 700) }, completedRequests: { r: { ...request('echo A', 500), completedAt: 600, status: 'approved' } } });
    const session = storage.getState().sessions[id];
    for (const messages of [roots(id), roots(id).reverse()]) {
        const pending = listPendingPermissionRequests(session, messages);
        expect(pending.find(req => req.id === 'r')).toMatchObject({ arguments: { command: 'echo B' }, requiresInspection: true });
        expect(pending.find(req => req.id === 'independent')).not.toHaveProperty('requiresInspection');
    }
    storage.getState().applyReady();
    expect(readDeskWaits().count).toBe(2);
    expect(readDeskWaits().items.find(item => item.requestId === 'r')).toMatchObject({ requiresInspection: true, disabledReason: null });
});

it('a scoped B execution result does not complete a newer different-payload A mirror', () => {
    const id = 'scoped';
    storage.getState().applySessions([createSessionFixture({ id, active: true, agentState: { requests: { r: request('echo B', 200) } } })]);
    storage.getState().applyMessages(id, [call('task', 'Task', {}, 250), call('r', 'Bash', { command: 'echo B' }, 300, 'task')]);
    snapshot(id, { requests: { r: request('echo A', 500) } });
    storage.getState().applyMessages(id, [{ id: 'scoped-result', localId: null, createdAt: 550,
        role: 'agent', isSidechain: true, sidechainId: 'task', content: [{ type: 'tool-result', tool_use_id: 'r',
            content: 'B ran', is_error: false, permissions: { result: 'approved', date: 550 }, uuid: 'result', parentUUID: null }] }]);
    expect(children(id)).toMatchObject([{ tool: { permission: { status: 'approved' }, state: 'completed', result: 'B ran' } }]);
    const mirror = roots(id).find(root => root.kind === 'tool-call' && root.tool.name === 'Bash');
    expect(mirror).toMatchObject({ tool: { input: { command: 'echo A' }, permission: { status: 'pending' }, result: undefined } });
    assertReaders(id, ['echo A']);
});

it.each(['echo A', 'echo B'])('live completion evidence distinguishes cold histories, initially visible request=%s', initialCommand => {
    for (const sawB of [true, false]) {
        const id = sawB ? 'saw-b' : 'missed-b';
        storage.getState().applySessions([createSessionFixture({ id, active: true, agentState: { requests: { r: request(initialCommand, 200) } } })]);
        storage.getState().applyMessages(id, [call('task', 'Task', {}, 250), call('r', 'Bash', { command: 'echo B' }, 300, 'task')]);
        if (sawB) snapshot(id, { requests: {}, completedRequests: { r: { ...request('echo B', 200), completedAt: 400, status: 'approved' } } });
        snapshot(id, { requests: { r: request('echo A', 500) }, completedRequests: {} });
        snapshot(id, { requests: {}, completedRequests: { r: { ...request('echo A', 500), completedAt: 600, status: 'approved' } } });
        storage.getState().applyMessagesLoaded(id);
        assertReaders(id, sawB ? [] : ['echo B']);
        const session = storage.getState().sessions[id];
        for (const messages of [roots(id), roots(id).reverse()]) {
            const full = buildTranscriptRenderableAggregate({ messages, completedRequests: session.agentState?.completedRequests ?? null });
            const pending = listPendingSessionRequests(session, [], { states: full.requestStates });
            expect(pending).toEqual(sawB ? [] : [expect.objectContaining({ requiresInspection: true, arguments: { command: 'echo B' } })]);
        }
    }
});

it('a same-payload later reopen restores the ordinary permission mirror before a new child arrives', () => {
    const id = 'same-payload';
    storage.getState().applySessions([createSessionFixture({ id, active: true, agentState: { requests: { r: request('echo B', 200) } } })]);
    storage.getState().applyMessages(id, [call('task', 'Task', {}, 250), call('r', 'Bash', { command: 'echo B' }, 300, 'task')]);
    snapshot(id, { requests: {}, completedRequests: { r: { ...request('echo B', 200), completedAt: 400, status: 'approved' } } });
    snapshot(id, { requests: { r: request('echo B', 500) }, completedRequests: {} });
    const mirror = roots(id).find(root => root.kind === 'tool-call' && root.tool.name === 'Bash');
    expect(mirror).toMatchObject({ tool: { permission: { status: 'pending' }, createdAt: 500, state: 'running', result: undefined, completedAt: null } });
    expect(children(id)).toMatchObject([{ tool: { permission: { status: 'approved' } } }]);
    assertReaders(id, ['echo B']);
});


it.each([false, true])('keeps ambiguous matching occurrences visible for inspection, completion before children=%s', completionFirst => {
    const id = 'ambiguous';
    storage.getState().applySessions([createSessionFixture({ id, active: true, agentState: { requests: { r: request('echo B', 200) } } })]);
    const messages = [call('task', 'Task', {}, 250), call('other', 'Task', {}, 251),
        call('r', 'Bash', { command: 'echo B' }, 300, 'task'), call('r', 'Bash', { command: 'echo B' }, 301, 'other')];
    if (!completionFirst) storage.getState().applyMessages(id, messages);
    snapshot(id, { requests: {}, completedRequests: { r: { ...request('echo B', 200), completedAt: 400, status: 'approved' } } });
    if (completionFirst) storage.getState().applyMessages(id, messages);
    expect(children(id).map(child => child.kind === 'tool-call' ? child.tool.permission?.status : null)).toEqual(['pending', 'pending']);
    assertReaders(id, ['echo B']);
    expect(listPendingPermissionRequests(storage.getState().sessions[id], roots(id))).toEqual([
        expect.objectContaining({ requiresInspection: true, arguments: { command: 'echo B' } }),
    ]);
    // A genuinely fresh producer request is still independently answerable.
    snapshot(id, { requests: { r: request('echo B', 500) }, completedRequests: {} });
    expect(listPendingSessionRequests(storage.getState().sessions[id])).toEqual([
        expect.objectContaining({ createdAt: 500, arguments: { command: 'echo B' } }),
    ]);
    expect(listPendingSessionRequests(storage.getState().sessions[id])[0]).not.toHaveProperty('requiresInspection');
});


it.each(['echo B', 'echo A'])('preserves executed main occurrence and result when r reopens as %s', command => {
    const id = 'executed-main';
    const original = request('echo B', 200);
    const completed = { ...original, completedAt: 400, status: 'approved' as const };
    storage.getState().applySessions([createSessionFixture({ id, active: true, agentState: { requests: { r: original } } })]);
    storage.getState().applyMessages(id, []);
    snapshot(id, { requests: {}, completedRequests: { r: completed } });
    const execution = call('r', 'Bash', original.arguments, 300);
    const result: NormalizedMessage = { id: 'main-result', localId: null, createdAt: 450, role: 'agent', isSidechain: false,
        content: [{ type: 'tool-result', tool_use_id: 'r', content: 'original B output', is_error: false,
            permissions: { result: 'approved', date: 400 }, uuid: 'main-result', parentUUID: null }] };
    storage.getState().applyMessages(id, [execution, result]);
    storage.getState().applyMessagesLoaded(id);
    const entry = storage.getState().sessionMessages[id];
    const originalId = entry.reducerState.toolIdToMessageId.get('r')!;
    const executed = entry.messagesById[originalId];
    expect(executed).toMatchObject({ tool: { startedAt: 300, completedAt: 450, state: 'completed', result: 'original B output', permission: { status: 'approved' } } });

    snapshot(id, { requests: { r: request(command, 500) }, completedRequests: { r: completed } });
    const reopened = storage.getState().sessionMessages[id];
    expect(reopened.messagesById[originalId]).toEqual(executed);
    const currentId = reopened.reducerState.toolIdToMessageId.get('r')!;
    expect(currentId).not.toBe(originalId);
    expect(reopened.reducerState.messageIds.get(execution.id)).toBe(originalId);
    expect(reopened.reducerState.permissions.get('r')).toMatchObject({ status: 'pending', createdAt: 500 });
    expect(reopened.messagesById[currentId]).toMatchObject({ tool: { createdAt: 500, startedAt: null, state: 'running', permission: { status: 'pending' }, result: undefined } });
    assertReaders(id, [command]);
    // Refresh/replay must not apply the old execution or result to the new mirror.
    storage.getState().applyMessages(id, [execution, result]);
    expect(storage.getState().sessionMessages[id].messagesById[originalId]).toEqual(executed);
    expect(storage.getState().sessionMessages[id].messagesById[currentId]).toMatchObject({ tool: { state: 'running', result: undefined, permission: { status: 'pending' } } });
    assertReaders(id, [command]);
    // Retracting a soft interruption on the newer mirror must retain the older
    // execution's hard outcome in the maintained index, just as a full fold does.
    snapshot(id, { requests: {}, completedRequests: { r: { ...request(command, 500), completedAt: 600, status: 'canceled', reason: 'Request interrupted' } } });
    snapshot(id, { requests: { r: request(command, 500) }, completedRequests: {} });
    const reconciled = storage.getState().sessionMessages[id];
    const full = buildTranscriptRenderableAggregate({ messages: roots(id), completedRequests: null });
    expect(reconciled.renderableAggregate?.requestStates.get('r')).toEqual(full.requestStates.get('r'));
    expect(reconciled.renderableAggregate?.requestStates.get('r')).toMatchObject({ status: 'pending', hardTerminalCreatedAt: 200 });
    expect(reconciled.messagesById[originalId]).toEqual(executed);
    snapshot(id, { requests: {}, completedRequests: { r: { ...request(command, 500), completedAt: 700, status: 'approved' } } });
    assertReaders(id, []);
    expect(storage.getState().sessionMessages[id].messagesById[originalId]).toEqual(executed);
    const nextExecution = call('r', 'Bash', { command }, 720);
    storage.getState().applyMessages(id, [nextExecution, { ...result, id: 'next-result', createdAt: 750,
        content: [{ type: 'tool-result', tool_use_id: 'r', content: 'new output', is_error: false,
            permissions: { result: 'approved', date: 700 }, uuid: 'next-result', parentUUID: null }] }]);
    const finished = storage.getState().sessionMessages[id];
    expect(finished.reducerState.messageIds.get(nextExecution.id)).toBe(currentId);
    expect(finished.reducerState.messageIds.get(execution.id)).toBe(originalId);
    expect(finished.messagesById[originalId]).toEqual(executed);
    expect(finished.messagesById[currentId]).toMatchObject({ tool: { startedAt: 720, completedAt: 750, state: 'completed', result: 'new output' } });
    assertReaders(id, []);
    storage.getState().evictSessionMessages(id);
    expect(storage.getState().sessionMessages[id]).toBeUndefined();
    storage.getState().applyMessages(id, []);
    expect(storage.getState().sessionMessages[id].reducerState.messageIds.has(execution.id)).toBe(false);
    expect(roots(id).some(message => message.id === originalId)).toBe(false);
});
