import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSessionFixture } from '@/dev/testkit/fixtures/sessionFixtures';
import { storage } from '@/sync/domains/state/storage';
import type { Message } from '@/sync/domains/messages/messageTypes';
import { buildTranscriptRenderableAggregate } from '@/sync/domains/messages/transcriptRenderableAggregate';
import type { Session } from '@/sync/domains/state/storageTypes';
import type { NormalizedMessage } from '@/sync/typesRaw';
import { listPendingPermissionRequests } from '@/utils/sessions/sessionUtils';
import { readDeskWaits } from '@/ignorePrevious/model/useDeskWaits';
import { buildSessionListRowModel } from '@/components/sessions/shell/row/buildSessionListRowModel';
import { buildSessionListRenderableFromSession, type SessionListRenderableSession } from '@/sync/domains/session/listing/sessionListRenderable';
import { listPendingSessionRequests, observePendingSessionRequest } from '@/sync/domains/session/pending/listPendingSessionRequests';
import { buildInboxSessionState } from '@/hooks/inbox/buildInboxSessionState';
import { getSessionActivityForVoiceTool } from '@/voice/tools/actionImpl/sessionActivity';

const sessionId = 'snapshot-worker';
let previous: ReturnType<typeof storage.getState>;

beforeEach(() => {
    previous = storage.getState();
    storage.setState({ sessions: {}, sessionMessages: {}, sessionListRenderables: {} });
});
afterEach(() => { storage.setState(previous, true); vi.restoreAllMocks(); });

function seedTranscript(withProjectedCounts = true) {
    storage.getState().applySessions([createSessionFixture({ id: sessionId, active: true,
        pendingPermissionRequestCount: withProjectedCounts ? 1 : undefined,
        pendingUserActionRequestCount: withProjectedCounts ? 0 : undefined,
        agentState: { requests: {}, completedRequests: {} } })]);
    storage.getState().applyMessages(sessionId, [{ id: 'tool', localId: null, createdAt: 1,
        role: 'agent', isSidechain: false, content: [{ type: 'tool-call', id: 'acted', name: 'Bash',
            input: { permissionId: 'acted', status: 'pending', command: 'echo acted' },
            description: null, uuid: 'tool', parentUUID: null }] }]);
    return storage.getState().sessionMessages[sessionId];
}

function pendingMessage(tool: string, id = 'request', createdAt = 1_001): NormalizedMessage {
    return { id: `message-${id}-${createdAt}`, localId: null, createdAt, seq: 10,
        role: 'agent', isSidechain: false, content: [{ type: 'tool-call', id, name: tool,
            input: { permissionId: id, status: 'pending', command: 'echo review' },
            description: null, uuid: `message-${id}-${createdAt}`, parentUUID: null }] };
}

// The ordinary virtualized row consumes the live renderable, not raw transcript requests.
function ordinaryRow(row: SessionListRenderableSession, item = row) {
    return buildSessionListRowModel({
        item: { type: 'session', session: item, groupKey: 'active', groupKind: 'active' },
        state: { renderable: row }, isFirst: true, isLast: true, isSingle: true,
        settings: {
            currentUserId: null, density: 'default', compact: false, compactMinimal: false,
            identityDisplay: 'avatar', activeColorMode: 'activityAndAttention', workingIndicatorMode: 'spinner',
            workingTextMode: 'static', hideInactiveSessions: false, showServerBadge: false,
            showPinnedServerBadge: true, agentActivityCountEnabled: false, tagsEnabled: false,
            sessionTagsByKey: {}, allKnownTags: [], pinnedSessionKeys: [], attentionStandingEnabled: false,
            attentionStandingPolicy: { defaultStanding: false, overridesBySessionKey: {} },
            hasMultipleMachines: false, reachableSessionDisplayByKey: {}, folderViewEnabled: false,
            relativeNowMs: 1_002, runtimeNowMs: 1_002,
            statusColors: { connected: 'connected', connecting: 'connecting', actionRequired: 'action',
                disconnected: 'disconnected', error: 'error', default: 'default' },
        },
    });
}

describe('session snapshots: transcript aggregates', () => {
    it('rebuilds an invalidated partial aggregate during public message refresh, with one historical store walk', () => {
        storage.getState().applySessions([createSessionFixture({ id: sessionId, active: true, agentState: null })]);
        const history: NormalizedMessage[] = Array.from({ length: 10_000 }, (_, index) => ({
            id: `public-history-${index}`, localId: null, createdAt: index + 100, seq: index + 1,
            role: 'user', isSidechain: false, content: { type: 'text', text: 'Historical text' },
        }));
        const stream: NormalizedMessage = { id: 'stream', localId: 'segment', createdAt: 20_000,
            seq: 20_000, role: 'agent', isSidechain: false,
            meta: { happierStreamSegmentV1: { v: 1, segmentKind: 'assistant', segmentLocalId: 'segment', updatedAtMs: 1 } },
            content: [{ type: 'text', text: 'Streaming', uuid: 'stream', parentUUID: null }] };
        storage.getState().applyMessages(sessionId, [...history, pendingMessage('Bash'), stream]);
        const entry = storage.getState().sessionMessages[sessionId];
        const aggregate = entry.renderableAggregate!;
        expect(entry.messageIdsOldestFirst).toHaveLength(10_002);
        const historicalIds = new Set(entry.messageIdsOldestFirst.filter(id => entry.messagesById[id].kind === 'user-text'));
        let historyReads = 0;
        let recordEnumerations = 0;
        let reducerVisits = 0;
        const messagesById = new Proxy(entry.messagesById, {
            get(target, key, receiver) {
                if (typeof key === 'string' && historicalIds.has(key)) historyReads++;
                return Reflect.get(target, key, receiver);
            },
            ownKeys(target) { recordEnumerations++; return Reflect.ownKeys(target); },
        });
        const iterate = entry.reducerState.messages[Symbol.iterator].bind(entry.reducerState.messages);
        vi.spyOn(entry.reducerState.messages, Symbol.iterator).mockImplementation(function* () {
            for (const pair of iterate()) { reducerVisits++; yield pair; }
            return undefined;
        });
        storage.setState({ sessionMessages: { [sessionId]: { ...entry, messagesById, messagesMap: messagesById } } });
        storage.getState().applyMessages(sessionId, [{ ...stream,
            transcriptObservationProvenance: { kind: 'non_dependent', source: 'history' },
            meta: { happierStreamSegmentV1: { v: 1, segmentKind: 'assistant', segmentLocalId: 'segment', updatedAtMs: 2 } },
        }]);
        const updated = storage.getState().sessionMessages[sessionId];
        expect(updated.isLoaded).toBe(false);
        expect(updated.renderableAggregate).not.toBe(aggregate);
        expect(updated.renderableAggregate?.latestCommittedMessageCreatedAt).toBe(10_099);
        expect(storage.getState().sessionListRenderables[sessionId].hasPendingPermissionRequests).toBe(true);
        expect(historyReads).toBe(10_000);
        expect(recordEnumerations).toBe(0);
        expect(reducerVisits).toBe(10_002);
    });

    it('retracts a sole interrupted contribution during a public partial snapshot without historical store reads', () => {
        storage.getState().applySessions([createSessionFixture({ id: sessionId, active: true, agentState: null })]);
        const history: NormalizedMessage[] = Array.from({ length: 10_000 }, (_, index) => ({
            id: `snapshot-history-${index}`, localId: null, createdAt: index + 100, seq: index + 1,
            role: 'user', isSidechain: false, content: { type: 'text', text: 'Historical text' },
        }));
        storage.getState().applyMessages(sessionId, [...history,
            pendingMessage('Bash'), pendingMessage('AskUserQuestion', 'resume', 20_000)]);
        const current = storage.getState().sessions[sessionId];
        storage.getState().applySessions([{ ...current, agentStateVersion: current.agentStateVersion + 1,
            agentState: { requests: {}, completedRequests: { resume: { tool: 'AskUserQuestion',
                arguments: { permissionId: 'resume', status: 'pending', command: 'echo review' },
                createdAt: 20_000, completedAt: 20_001, status: 'canceled', reason: 'Request interrupted' } } } }]);
        const entry = storage.getState().sessionMessages[sessionId];
        expect(entry.messageIdsOldestFirst).toHaveLength(10_002);
        const historicalIds = new Set(entry.messageIdsOldestFirst.filter(id => entry.messagesById[id].kind === 'user-text'));
        let historyReads = 0;
        let recordEnumerations = 0;
        let reducerVisits = 0;
        const messagesById = new Proxy(entry.messagesById, {
            get(target, key, receiver) {
                if (typeof key === 'string' && historicalIds.has(key)) historyReads++;
                return Reflect.get(target, key, receiver);
            },
            ownKeys(target) { recordEnumerations++; return Reflect.ownKeys(target); },
        });
        const iterate = entry.reducerState.messages[Symbol.iterator].bind(entry.reducerState.messages);
        vi.spyOn(entry.reducerState.messages, Symbol.iterator).mockImplementation(function* () {
            for (const pair of iterate()) { reducerVisits++; yield pair; }
            return undefined;
        });
        storage.setState({ sessionMessages: { [sessionId]: { ...entry, messagesById, messagesMap: messagesById } } });
        storage.getState().applySessions([{ ...current, agentStateVersion: current.agentStateVersion + 2,
            agentState: { requests: { resume: { tool: 'AskUserQuestion',
                arguments: { permissionId: 'resume', status: 'pending', command: 'echo review' }, createdAt: 20_000 } },
                completedRequests: null } }]);
        expect(storage.getState().sessionMessages[sessionId].isLoaded).toBe(false);
        expect(storage.getState().sessionMessages[sessionId].renderableAggregate?.requestStates.get('resume'))
            .toMatchObject({ status: 'pending' });
        expect(storage.getState().sessionListRenderables[sessionId]).toMatchObject({
            hasPendingPermissionRequests: true, hasPendingUserActionRequests: true,
        });
        expect(historyReads).toBe(0);
        expect(recordEnumerations).toBe(0);
        // The existing agent-state reducer still visits its retained records; no O(changed) claim.
        expect(reducerVisits).toBe(10_002);
    });

    it.each([false, true])('keeps unrelated transcript evidence when an interrupted request resumes, loaded=%s', loaded => {
        storage.getState().applySessions([createSessionFixture({ id: sessionId, active: true, agentState: null,
            pendingPermissionRequestCount: undefined, pendingUserActionRequestCount: undefined })]);
        storage.getState().applyMessages(sessionId, [pendingMessage('Bash'), pendingMessage('AskUserQuestion', 'resume', 1_100)]);
        if (loaded) storage.getState().applyMessagesLoaded(sessionId);
        const current = storage.getState().sessions[sessionId];
        storage.getState().applySessions([{ ...current, agentStateVersion: current.agentStateVersion + 1,
            agentState: { requests: {}, completedRequests: { resume: { tool: 'AskUserQuestion',
                arguments: { permissionId: 'resume', status: 'pending', command: 'echo review' },
                createdAt: 1_100, completedAt: 1_101, status: 'canceled', reason: 'Request interrupted' } } } }]);
        expect(storage.getState().sessionMessages[sessionId].renderableAggregate?.requestStates.get('resume'))
            .toMatchObject({ status: 'terminal', terminalKind: 'soft_interrupted' });
        storage.getState().applySessions([{ ...current, agentStateVersion: current.agentStateVersion + 2,
            agentState: { requests: { resume: { tool: 'AskUserQuestion',
                arguments: { permissionId: 'resume', status: 'pending', command: 'echo review' }, createdAt: 1_100 } },
                completedRequests: null } }]);
        expect(listPendingSessionRequests(storage.getState().sessions[sessionId])).toMatchObject([
            { id: 'request' }, { id: 'resume' },
        ]);
        expect(storage.getState().sessionListRenderables[sessionId].hasPendingPermissionRequests).toBe(true);
        storage.getState().applySessions([{ ...current, agentStateVersion: current.agentStateVersion + 3,
            agentState: { requests: {}, completedRequests: null } }]);
        expect(listPendingSessionRequests(storage.getState().sessions[sessionId])).toMatchObject([
            { id: 'request' }, { id: 'resume' },
        ]);
        expect(storage.getState().sessionListRenderables[sessionId].hasPendingUserActionRequests).toBe(true);
    });

    it.each([
        ['Bash', 'hasPendingPermissionRequests', 'permission_required'],
        ['AskUserQuestion', 'hasPendingUserActionRequests', 'action_required'],
    ] as const)('keeps transcript-only %s pending in ordinary rows across an unrelated partial snapshot', async (tool, flag, status) => {
        vi.spyOn(Date, 'now').mockReturnValue(1_002);
        storage.getState().applySessions([createSessionFixture({ id: sessionId, active: true,
            createdAt: 1_000, activeAt: 1_000, updatedAt: 1_000, agentState: null,
            pendingPermissionRequestCount: undefined, pendingUserActionRequestCount: undefined })]);
        storage.getState().applyMessages(sessionId, [pendingMessage(tool)]);
        const before = storage.getState().sessionListRenderables[sessionId];
        expect(storage.getState().sessionMessages[sessionId].isLoaded).toBe(false);
        expect(before[flag]).toBe(true);
        expect(before.pendingRequestObservedAt).toBe(1_001);
        expect(ordinaryRow(before).status.state).toBe(status);
        const current = storage.getState().sessions[sessionId];
        storage.getState().applySessions([{ ...current, updatedAt: 1_002 }]);
        const after = storage.getState().sessionListRenderables[sessionId];
        expect(listPendingSessionRequests(storage.getState().sessions[sessionId])).toMatchObject([{ id: 'request' }]);
        expect(after[flag]).toBe(true);
        expect(after.pendingRequestObservedAt).toBe(1_001);
        expect(ordinaryRow(after, before).status.state).toBe(status);
        expect(ordinaryRow(after, before).attention.rowState).toBe(status);
        storage.getState().applyReady();
        const state = storage.getState();
        expect(buildInboxSessionState({ sessions: Object.values(state.sessions),
            sessionMessagesById: state.sessionMessages, nowMs: 1_002 }).sessionsNeedingAttention)
            .toMatchObject([{ sessionId, reason: status }]);
        expect(await getSessionActivityForVoiceTool({ sessionId })).toMatchObject({ ok: true,
            permissionRequired: tool === 'Bash', actionRequired: tool === 'AskUserQuestion' });
        expect(readDeskWaits().items).toMatchObject([{ sessionId, requestId: 'request' }]);
    });

    it.each([
        ['in_progress', false],
        ['completed', true],
    ] as const)('does not promote partial history into snapshot unread or activity evidence for a %s turn', (latestTurnStatus, hasUnreadMessages) => {
        storage.getState().applySessions([createSessionFixture({ id: sessionId, active: true,
            createdAt: 1_000, meaningfulActivityAt: 1_000, lastViewedSessionSeq: 1,
            latestTurnStatus, agentState: null })]);
        storage.getState().applyMessages(sessionId, [{ id: 'text', localId: null,
            createdAt: 9_000, seq: 30, role: 'agent', isSidechain: false,
            content: [{ type: 'text', text: 'Partial history', uuid: 'text', parentUUID: null }] }, pendingMessage('Bash')]);
        const before = storage.getState().sessionListRenderables[sessionId];
        expect(before.hasUnreadMessages).toBe(true);
        expect(before.meaningfulActivityAt).toBe(9_000);
        const current = storage.getState().sessions[sessionId];
        const snapshotBasis = buildSessionListRenderableFromSession(current, []);
        expect(snapshotBasis.hasUnreadMessages).toBe(hasUnreadMessages);
        expect(snapshotBasis.meaningfulActivityAt).toBe(1_000);
        storage.getState().applySessions([{ ...current, updatedAt: 1_002 }]);
        const after = storage.getState().sessionListRenderables[sessionId];
        // A terminal session uses its advanced sequence even without loaded messages;
        // an in-progress session has no such fallback. Lifecycle reconciliation retains
        // the previous row's activity timestamp; the snapshot does not derive it anew.
        expect(current.seq).toBe(30);
        expect(after.hasPendingPermissionRequests).toBe(true);
        expect(after.hasUnreadMessages).toBe(hasUnreadMessages);
        expect(after.meaningfulActivityAt).toBe(9_000);
    });

    it.each(['Bash', 'AskUserQuestion'])('honors partial %s terminal evidence over lagging projected counts and stale agentState', async tool => {
        vi.spyOn(Date, 'now').mockReturnValue(1_003);
        storage.getState().applySessions([createSessionFixture({ id: sessionId, active: true,
            pendingPermissionRequestCount: tool === 'Bash' ? 1 : 0,
            pendingUserActionRequestCount: tool === 'AskUserQuestion' ? 1 : 0,
            pendingRequestObservedAt: 1_001, agentState: null })]);
        storage.getState().applyMessages(sessionId, [pendingMessage(tool)]);
        const before = storage.getState().sessionListRenderables[sessionId];
        storage.getState().applyMessages(sessionId, [{ id: 'result', localId: null, createdAt: 1_002,
            role: 'agent', isSidechain: false, content: [{ type: 'tool-result', tool_use_id: 'request',
                content: 'Done', is_error: false, permissions: { result: 'approved', date: 1_002 },
                uuid: 'result', parentUUID: null }] }]);
        const current = storage.getState().sessions[sessionId];
        storage.getState().applySessions([{ ...current, updatedAt: 1_003,
            agentStateVersion: current.agentStateVersion + 1, agentState: { requests: {
                request: { tool, arguments: { permissionId: 'request', status: 'pending', command: 'echo review' }, createdAt: 1_001 },
            }, completedRequests: null } }]);
        const after = storage.getState().sessionListRenderables[sessionId];
        expect(after.hasPendingPermissionRequests).toBe(false);
        expect(after.hasPendingUserActionRequests).toBe(false);
        expect(after.pendingRequestObservedAt).toBeNull();
        expect(ordinaryRow(after, before).status.state).not.toMatch(/permission_required|action_required/);
        expect(storage.getState().sessionMessages[sessionId].renderableAggregate?.requestStates.get('request')?.status).toBe('terminal');
        const state = storage.getState();
        expect(listPendingSessionRequests(state.sessions[sessionId])).toEqual([]);
        expect(buildInboxSessionState({ sessions: Object.values(state.sessions),
            sessionMessagesById: state.sessionMessages, nowMs: 1_003 }).sessionsNeedingAttention).toEqual([]);
        expect(await getSessionActivityForVoiceTool({ sessionId })).toMatchObject({ ok: true,
            permissionRequired: false, actionRequired: false });
        storage.getState().applyReady();
        expect(readDeskWaits().items).toEqual([]);
    });

    it('refreshes partial completion references, retains terminal evidence after removal, and clears lifecycle state', () => {
        storage.getState().applySessions([createSessionFixture({ id: sessionId, active: true, agentState: null })]);
        storage.getState().applyMessages(sessionId, [pendingMessage('Bash')]);
        const current = storage.getState().sessions[sessionId];
        const completedRequests = { request: { tool: 'Bash', arguments: { permissionId: 'request',
            status: 'pending', command: 'echo review' }, createdAt: 1_001, completedAt: 1_002, status: 'approved' } } satisfies NonNullable<Session['agentState']>['completedRequests'];
        storage.getState().applySessions([{ ...current, agentStateVersion: current.agentStateVersion + 1,
            agentState: { requests: {}, completedRequests } }]);
        const entry = storage.getState().sessionMessages[sessionId];
        expect(entry.isLoaded).toBe(false);
        expect(entry.renderableAggregate?.completedRequestsRef).toBe(completedRequests);
        expect(entry.renderableAggregate?.requestStates.get('request')?.status).toBe('terminal');
        expect(storage.getState().sessionListRenderables[sessionId].hasPendingPermissionRequests).toBe(false);
        storage.getState().applySessions([{ ...storage.getState().sessions[sessionId],
            agentStateVersion: current.agentStateVersion + 2, agentState: { requests: {}, completedRequests: null } }]);
        expect(storage.getState().sessionMessages[sessionId].renderableAggregate?.completedRequestsRef).toBeNull();
        expect(storage.getState().sessionListRenderables[sessionId].hasPendingPermissionRequests).toBe(false);

        storage.getState().resetSessionMessages(sessionId);
        storage.getState().applySessions([{ ...current, updatedAt: 1_004 }]);
        expect(storage.getState().sessionListRenderables[sessionId].hasPendingPermissionRequests).toBe(false);
        storage.getState().applyMessages(sessionId, [pendingMessage('Bash', 'new-request', 1_005)]);
        storage.getState().applySessions([{ ...current, active: false, updatedAt: 1_006 }]);
        expect(storage.getState().sessionListRenderables[sessionId].hasPendingPermissionRequests).toBe(false);
        storage.getState().applySessions([{ ...current, active: true, updatedAt: 1_007 }]);
        expect(storage.getState().sessionListRenderables[sessionId].hasPendingPermissionRequests).toBe(true);
        storage.getState().deleteSession(sessionId);
        expect(storage.getState().sessionMessages[sessionId]).toBeUndefined();
        storage.getState().applySessions([{ ...current, updatedAt: 1_008 }]);
        expect(storage.getState().sessionListRenderables[sessionId].hasPendingPermissionRequests).toBe(false);
    });

    it('retains an R24 counted placeholder when partial history provides no request details', () => {
        storage.getState().applySessions([createSessionFixture({ id: sessionId, active: true,
            pendingPermissionRequestCount: 1, agentState: null })]);
        storage.getState().applyMessages(sessionId, []);
        storage.getState().applyReady();
        const current = storage.getState().sessions[sessionId];
        storage.getState().applySessions([{ ...current, updatedAt: 1_002 }]);
        const waits = readDeskWaits();
        expect(waits.count).toBe(1);
        expect(waits.items).toEqual([]);
        expect(waits.unloaded).toMatchObject([{ sessionId, reason: 'notLoaded' }]);
    });

    it('F3: normal same-ID ingestion coalesces the older terminal and later pending instead of producing the counterexample', () => {
        storage.getState().applySessions([createSessionFixture({ id: sessionId, active: true, agentState: null })]);
        const first = pendingMessage('Bash', 'r', 200);
        if (first.role !== 'agent' || first.content[0].type !== 'tool-call') throw new Error('Expected tool call');
        first.content[0].input = { permissionId: 'r', status: 'pending', command: 'echo A' };
        storage.getState().applyMessages(sessionId, [first]);
        storage.getState().applyMessages(sessionId, [{ id: 'terminal', localId: null, createdAt: 201,
            role: 'agent', isSidechain: false, content: [{ type: 'tool-result', tool_use_id: 'r',
                content: 'Approved', is_error: false, permissions: { result: 'approved', date: 201 },
                uuid: 'terminal', parentUUID: null }] }]);
        const later = pendingMessage('Bash', 'r', 300);
        if (later.role !== 'agent' || later.content[0].type !== 'tool-call') throw new Error('Expected tool call');
        later.content[0].input = { permissionId: 'r', status: 'pending', command: 'echo B' };
        storage.getState().applyMessages(sessionId, [later]);
        const current = storage.getState().sessions[sessionId];
        storage.getState().applySessions([{ ...current, agentStateVersion: current.agentStateVersion + 1,
            agentState: { requests: { r: { tool: 'Bash', arguments: { command: 'echo A' }, createdAt: 100 } },
                completedRequests: { r: { tool: 'Bash', arguments: later.content[0].input,
                    createdAt: 300, completedAt: 400, status: 'approved' } } } }]);
        const entry = storage.getState().sessionMessages[sessionId];
        expect(entry.messageIdsOldestFirst).toHaveLength(1);
        expect(entry.messagesById[entry.messageIdsOldestFirst[0]].createdAt).toBe(200);
        expect(entry.renderableAggregate?.requestStates.get('r')).toMatchObject({ status: 'terminal', createdAt: 200 });
        const session = storage.getState().sessions[sessionId];
        expect(listPendingSessionRequests(session)).toEqual([]);
        expect(observePendingSessionRequest(session, 'r', entry.renderableAggregate?.requestStates.get('r')).status).toBe('terminal');
    });

    it.each([
        ['stale A behind completed B', 100, 400, 'echo A', null],
        ['uncovered A after terminal', 250, 400, 'echo A', 250],
        ['unknown A behind terminal', undefined, 400, 'echo A', null],
        ['B newer than its completion', 100, 250, 'echo A', 300],
        ['B exactly at completion', 100, 300, 'echo A', null],
        ['no terminal leaves agent authority intact', 100, null, 'echo A', 100],
        ['new B after completed B', 500, 400, 'echo B', 500],
        ['new same-ID A reopen', 500, 400, 'echo A', 500],
    ] as const)('reconciles nested same-ID requests across ordinary, full and incremental readers: %s',
        (scenario, agentCreatedAt, completedAt, agentCommand, expectedAt) => {
            storage.getState().applySessions([createSessionFixture({ id: sessionId, active: true,
                agentState: { requests: { r: { tool: 'Bash', arguments: { command: 'echo A' }, createdAt: 200 } } } })]);
            const parent = pendingMessage('Task', 'task', 250);
            if (parent.role !== 'agent' || parent.content[0].type !== 'tool-call') throw new Error('Expected tool call');
            parent.content[0].input = { prompt: 'Nested work' };
            storage.getState().applyMessages(sessionId, [parent]);
            const child = pendingMessage('Bash', 'r', 300);
            if (child.role !== 'agent' || child.content[0].type !== 'tool-call') throw new Error('Expected tool call');
            child.content[0].input = { command: 'echo B' };
            storage.getState().applyMessages(sessionId, [{ ...child, isSidechain: true, sidechainId: 'task' }]);
            const current = storage.getState().sessions[sessionId];
            storage.getState().applySessions([{ ...current, agentStateVersion: current.agentStateVersion + 1,
                agentState: { requests: { r: { tool: 'Bash', arguments: { command: agentCommand }, createdAt: agentCreatedAt } },
                    completedRequests: completedAt === null ? null : { r: { tool: 'Bash', arguments: { command: 'echo B' },
                        createdAt: Math.min(300, completedAt), completedAt, status: 'approved' } } } }]);
            const entry = storage.getState().sessionMessages[sessionId];
            const session = storage.getState().sessions[sessionId];
            const roots = entry.messageIdsOldestFirst.map(id => entry.messagesById[id]);
            expect(roots).toHaveLength(2);
            if (scenario === 'stale A behind completed B') {
                expect(roots[0]).toMatchObject({ kind: 'tool-call', createdAt: 200,
                    tool: { input: { command: 'echo A' }, permission: { id: 'r', status: 'approved' } } });
                expect(roots[1]).toMatchObject({ kind: 'tool-call', createdAt: 250,
                    children: [{ createdAt: 300, tool: { input: { command: 'echo B' }, permission: { id: 'r', status: 'pending' } } }] });
            }
            const expected = expectedAt === null ? [] : [{ id: 'r', tool: 'Bash', kind: 'permission',
                arguments: { command: expectedAt === 300 ? 'echo B' : agentCommand }, createdAt: expectedAt }];
            // The real ordinary helper is used by Inbox and voice, not only Desk.
            expect(listPendingPermissionRequests(session, roots)).toEqual(expected);
            expect(listPendingSessionRequests(session)).toEqual(expected);
            const incremental = entry.renderableAggregate!.requestStates;
            for (const messages of [roots, [...roots].reverse()]) {
                const full = buildTranscriptRenderableAggregate({ messages,
                    completedRequests: session.agentState?.completedRequests ?? null });
                expect(full.requestStates.get('r')).toEqual(incremental.get('r'));
                expect(listPendingPermissionRequests(session, messages)).toEqual(expected);
                for (const states of [incremental, full.requestStates]) {
                    expect(listPendingSessionRequests(session, [], { states })).toEqual(expected);
                    expect(observePendingSessionRequest(session, 'r', states.get('r'))).toEqual(
                        expected.length ? { status: 'pending', request: expected[0] } : { status: 'terminal' });
                }
            }
            const addDisplayMetadata = (message: Message): Message => message.kind === 'tool-call'
                ? { ...message, tool: { ...message.tool, description: 'Transcript display detail',
                    ...(message.tool.permission ? { permission: { ...message.tool.permission,
                        suggestions: [{ type: 'toolAlwaysAllow', tool: 'Bash' }] } } : {}) },
                    children: message.children.map(addDisplayMetadata) }
                : message;
            const metadataRoots = roots.map(addDisplayMetadata);
            for (const messages of [metadataRoots, [...metadataRoots].reverse()]) {
                const full = buildTranscriptRenderableAggregate({ messages,
                    completedRequests: session.agentState?.completedRequests ?? null });
                for (const requests of [listPendingPermissionRequests(session, messages),
                    listPendingSessionRequests(session, [], { states: full.requestStates })]) {
                    expect(requests).toHaveLength(expected.length);
                    expect(requests).toMatchObject(expected);
                }
                const observed = observePendingSessionRequest(session, 'r', full.requestStates.get('r'));
                expect(observed).toMatchObject(expected.length
                    ? { status: 'pending', request: expected[0] } : { status: 'terminal' });
            }
            storage.getState().applyReady();
            expect(readDeskWaits().items.filter(item => item.sessionId === sessionId).map(item => item.requestId))
                .toEqual(expected.map(request => request.id));
            if (expectedAt === 500 && agentCommand === 'echo B') {
                // Answer the same-payload reopen while requests still lag behind completion.
                storage.getState().applySessions([{ ...session, agentStateVersion: session.agentStateVersion + 1,
                    agentState: { requests: session.agentState!.requests,
                        completedRequests: { r: { tool: 'Bash', arguments: { command: agentCommand },
                            createdAt: 500, completedAt: 600, status: 'approved' } } } }]);
                const answered = storage.getState().sessions[sessionId];
                const answeredEntry = storage.getState().sessionMessages[sessionId];
                const answeredRoots = answeredEntry.messageIdsOldestFirst.map(id => answeredEntry.messagesById[id]);
                expect(listPendingPermissionRequests(answered, answeredRoots)).toEqual([]);
                expect(listPendingSessionRequests(answered, [], { states: answeredEntry.renderableAggregate!.requestStates })).toEqual([]);
                expect(observePendingSessionRequest(answered, 'r', answeredEntry.renderableAggregate!.requestStates.get('r')).status)
                    .toBe('terminal');
                expect(readDeskWaits().items.filter(item => item.sessionId === sessionId)).toEqual([]);
            }
        });

    it.each(['missing aggregate', 'unchanged completions', 'completion identity', 'completion contents',
        'removed completions', 'transcript identity'] as const)(
        'does not enumerate a 10,000-message partial transcript with %s', scenario => {
            const entry = seedTranscript(scenario !== 'unchanged completions');
            const session = storage.getState().sessions[sessionId];
            const messages: Message[] = [...entry.messageIdsOldestFirst.map(id => entry.messagesById[id]!),
                ...Array.from({ length: 10_000 }, (_, index): Message => ({
                id: `historical-${index}`, kind: 'agent-text', localId: null,
                createdAt: index + 10, text: 'Historical text',
            }))];
            const aggregate = scenario === 'missing aggregate' ? undefined : buildTranscriptRenderableAggregate({
                messages, completedRequests: session.agentState!.completedRequests ?? null,
            });
            let messageReads = 0;
            let enumerations = 0;
            let reducerVisits = 0;
            const iterate = entry.reducerState.messages[Symbol.iterator].bind(entry.reducerState.messages);
            vi.spyOn(entry.reducerState.messages, Symbol.iterator).mockImplementation(function* () {
                for (const pair of iterate()) { reducerVisits++; yield pair; }
                return undefined;
            });
            const messagesById = new Proxy(Object.fromEntries(messages.map(message => [message.id, message])), {
                get(target, key, receiver) {
                    if (typeof key === 'string' && key.startsWith('historical-')) messageReads++;
                    return Reflect.get(target, key, receiver);
                },
                ownKeys(target) { enumerations++; return Reflect.ownKeys(target); },
            });
            const ids = new Proxy(messages.map(message => message.id), {
                get(target, key, receiver) {
                    if (key === Symbol.iterator || (typeof key === 'string' && /^\d+$/.test(key))) enumerations++;
                    return Reflect.get(target, key, receiver);
                },
            });
            const partial = { ...entry, isLoaded: false, messageIdsOldestFirst: ids,
                messagesById, messagesMap: messagesById, renderableAggregate: aggregate,
                latestThinkingMessageId: null };
            storage.setState({ sessionMessages: { [sessionId]: partial } });
            if (scenario === 'transcript identity') {
                const replacementMessages = new Proxy(messagesById, {});
                storage.setState({ sessionMessages: { [sessionId]: { ...partial,
                    messageIdsOldestFirst: new Proxy(ids, {}), messagesById: replacementMessages,
                    messagesMap: replacementMessages, messagesVersion: partial.messagesVersion + 1 } } });
            }
            const completedRequests: NonNullable<Session['agentState']>['completedRequests'] =
                scenario === 'completion contents' ? { acted: { tool: 'Bash', arguments: { command: 'echo acted' },
                    createdAt: 1, completedAt: 2, status: 'approved' } }
                    : scenario === 'removed completions' ? null
                    : scenario === 'completion identity' ? {} : session.agentState!.completedRequests;

            storage.getState().applySessions([{ ...session, updatedAt: session.updatedAt + 1,
                agentStateVersion: session.agentStateVersion + 1,
                agentState: { requests: {}, completedRequests } }]);

            expect(messageReads, 'snapshot read partial message bodies').toBe(0);
            expect(enumerations, 'snapshot traversed partial message IDs or records').toBe(0);
            // These legacy-shape fixtures add store history but retain only the one real reducer tool.
            expect(reducerVisits).toBe(1);
            const stored = storage.getState().sessionMessages[sessionId];
            expect(stored.isLoaded).toBe(false);
            // No cold build or request-map copy is needed, including when real reconciliation
            // changes a tool. Missing contributions remain unknown.
            expect(stored.renderableAggregate?.requestStates).toBe(aggregate?.requestStates);
            if (aggregate) expect(stored.renderableAggregate?.completedRequestsRef).toBe(completedRequests);
            else expect(stored.renderableAggregate).toBeUndefined();
            expect(storage.getState().sessions[sessionId].agentState?.completedRequests).toBe(completedRequests);
            expect(storage.getState().sessionListRenderables[sessionId].hasPendingPermissionRequests).toBe(true);
        },
    );

    it('rebuilds a missing loaded aggregate and refreshes its completion basis on snapshots', () => {
        const entry = seedTranscript();
        storage.getState().applyMessagesLoaded(sessionId);
        storage.setState({ sessionMessages: { [sessionId]: { ...storage.getState().sessionMessages[sessionId],
            renderableAggregate: undefined } } });
        const session = storage.getState().sessions[sessionId];
        storage.getState().applySessions([{ ...session, updatedAt: session.updatedAt + 1 }]);
        const first = storage.getState().sessionMessages[sessionId].renderableAggregate!;
        expect(first.messageCount).toBe(entry.messageIdsOldestFirst.length);
        expect(first.requestStates.get('acted')?.status).toBe('pending');
        const sameCompletions = {};
        storage.getState().applySessions([{ ...session, agentStateVersion: session.agentStateVersion + 1,
            agentState: { requests: {}, completedRequests: sameCompletions } }]);
        const refreshed = storage.getState().sessionMessages[sessionId].renderableAggregate!;
        expect(refreshed.completedRequestsRef).toBe(sameCompletions);
        expect(refreshed.requestStates.get('acted')?.status).toBe('pending');
        const completedRequests = { acted: { tool: 'Bash', arguments: { command: 'echo acted' },
            createdAt: 1, completedAt: 2, status: 'approved' } } satisfies NonNullable<Session['agentState']>['completedRequests'];
        storage.getState().applySessions([{ ...session, agentStateVersion: session.agentStateVersion + 2,
            agentState: { requests: {}, completedRequests } }]);
        const stored = storage.getState().sessionMessages[sessionId];
        expect(stored.isLoaded).toBe(true);
        expect(stored.renderableAggregate?.completedRequestsRef).toBe(completedRequests);
        expect(stored.renderableAggregate?.requestStates.get('acted')?.status).not.toBe('pending');
    });
});
