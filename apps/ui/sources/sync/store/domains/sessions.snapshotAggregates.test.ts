import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSessionFixture } from '@/dev/testkit/fixtures/sessionFixtures';
import { storage } from '@/sync/domains/state/storage';
import type { Message } from '@/sync/domains/messages/messageTypes';
import { buildTranscriptRenderableAggregate } from '@/sync/domains/messages/transcriptRenderableAggregate';
import type { Session } from '@/sync/domains/state/storageTypes';

const sessionId = 'snapshot-worker';
let previous: ReturnType<typeof storage.getState>;

beforeEach(() => {
    previous = storage.getState();
    storage.setState({ sessions: {}, sessionMessages: {}, sessionListRenderables: {} });
});
afterEach(() => storage.setState(previous, true));

function seedTranscript() {
    storage.getState().applySessions([createSessionFixture({ id: sessionId, active: true,
        pendingPermissionRequestCount: 1, pendingUserActionRequestCount: 0,
        agentState: { requests: {}, completedRequests: {} } })]);
    storage.getState().applyMessages(sessionId, [{ id: 'tool', localId: null, createdAt: 1,
        role: 'agent', isSidechain: false, content: [{ type: 'tool-call', id: 'acted', name: 'Bash',
            input: { permissionId: 'acted', status: 'pending', command: 'echo acted' },
            description: null, uuid: 'tool', parentUUID: null }] }]);
    return storage.getState().sessionMessages[sessionId];
}

describe('session snapshots: transcript aggregates', () => {
    it.each(['missing aggregate', 'unchanged completions', 'completion identity', 'completion contents',
        'removed completions', 'transcript identity'] as const)(
        'does not enumerate a 10,000-message partial transcript with %s', scenario => {
            const entry = seedTranscript();
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
