import { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { V2SessionRecord } from '@happier-dev/protocol';

import { createSessionFixture, renderHook, standardCleanup } from '@/dev/testkit';
import { storage } from '@/sync/domains/state/storage';
import { buildSessionListRenderableFromSession } from '@/sync/domains/session/listing/sessionListRenderable';
import { installSessionRecordHarness } from '../testkit/sessionRecordHarness';
import { useDeskWorkerRecordConsumers } from './useDeskWorkerRecordConsumers';
import { handleUpdateContainer } from '@/sync/engine/socket/socket';
import type { ArtifactDataKeyCache } from '@/sync/engine/artifacts/syncArtifacts';

import { useDeskSessions } from '../useDeskSessions';
import { useDeskWaits } from './useDeskWaits';
import { useIssueKeys } from './useIssueKeys';

// Voice is an external side effect of applying a newly hydrated permission request.
vi.mock('@/voice/context/voiceHooks', () => ({ voiceHooks: { onAgentRequest: vi.fn(), onSessionOnline: vi.fn(), onSessionOffline: vi.fn() } }));

const workerId = 'cold-worker';
const requestId = 'cold-request';

/** Wire fields from mapV2SessionListRow; payloads match deskSeed and SyntheticAgent. */
function plainWaitingWorker(): V2SessionRecord {
    const now = Date.now();
    return {
        id: workerId,
        seq: 1,
        createdAt: now,
        updatedAt: now,
        meaningfulActivityAt: now,
        active: true,
        activeAt: now,
        archivedAt: null,
        encryptionMode: 'plain',
        metadata: JSON.stringify({ v: 1, flavor: 'claude', name: 'Fixing the build', path: '/tmp/desk-worker', tag: 'ATR-101-build' }),
        metadataVersion: 1,
        agentState: JSON.stringify({ requests: { [requestId]: { tool: 'Bash', arguments: { command: 'yarn db:migrate' }, createdAt: now } } }),
        agentStateVersion: 1,
        lastViewedSessionSeq: 0,
        pendingPermissionRequestCount: 1,
        pendingUserActionRequestCount: 0,
        pendingRequestObservedAt: now,
        pendingBlockedCount: 0,
        pendingCount: 0,
        pendingVersion: 0,
        runtimeActivityState: 'unknown',
        runtimeActivityActiveCount: 0,
        runtimeActivityObservedAt: null,
        runtimeActivityRevision: 0,
        dataEncryptionKey: null,
        share: null,
    };
}

describe('desk details through the session snapshot owner', () => {
    let harness: ReturnType<typeof installSessionRecordHarness>;
    let previous: ReturnType<typeof storage.getState>;
    beforeEach(() => {
        previous = storage.getState();
        storage.setState({ sessions: {}, sessionListRenderables: {}, sessionMessages: {}, sessionListViewData: null });
        harness = installSessionRecordHarness([plainWaitingWorker()]);
    });
    afterEach(() => {
        standardCleanup();
        harness.restore();
        storage.setState(previous, true);
    });

    it.each([
        { name: 'F5 cold list snapshot without a session opened', required: false },
        { name: 'control: the same payload with explicitly required hydration', required: true },
    ])('$name exposes the tag and actionable request', async ({ required }) => {
        // A cold record with a known index row, as when the desk mounts on the list
        // restored at boot. Only the projection is seeded, never the full record.
        storage.getState().replaceSessionListRenderables([buildSessionListRenderableFromSession(createSessionFixture({
            id: workerId, active: true, archivedAt: null,
            metadata: { path: '/tmp/desk-worker', flavor: 'claude', host: 'test-host', version: '1' },
        }))]);
        storage.getState().applyReady();
        expect(storage.getState().sessions[workerId]).toBeUndefined();
        const hook = await renderHook(() => {
            const desk = useDeskSessions();
            useDeskWorkerRecordConsumers(desk.list, null);
            return { keys: useIssueKeys(desk), waits: useDeskWaits() };
        });
        await act(async () => {
            if (required) {
                // The same explicit requirement as the original control, through the real sync owner.
                await (harness.sync as unknown as { fetchSessions: (options: { requiredHydrationSessionIds: string[]; awaitSessionListHydration: boolean }) => Promise<void> })
                    .fetchSessions({ requiredHydrationSessionIds: [workerId], awaitSessionListHydration: true });
            } else {
                await harness.sync.refreshSessions({ awaitSessionListHydration: false });
            }
            storage.getState().applyReady();
        });
        await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
        await vi.waitFor(() => expect(storage.getState().sessions[workerId]).toBeDefined());
        await act(async () => {});

        // Exact reads would let the late-registration path hide a missing snapshot requirement.
        expect(harness.http.mock.calls.filter(([path]) => path === `/v2/sessions/${workerId}`)).toEqual([]);
        expect(storage.getState().sessionListRenderables[workerId]?.hasPendingPermissionRequests).toBe(true);
        expect(hook.getCurrent().waits.count).toBe(1);
        expect.soft(hook.getCurrent().keys.get(workerId)).toBe('ATR-101');
        expect.soft(hook.getCurrent().waits.items).toEqual([
            expect.objectContaining({ requestId, detail: 'yarn db:migrate', disabledReason: null }),
        ]);
        expect.soft(hook.getCurrent().waits.unloaded).toEqual([]);

        // Socket boundary inputs; socket routing, full-record application and desk selectors stay real.
        const noTranscript = vi.fn(() => { throw new Error('Record consumer started transcript work'); });
        const artifactDataKeys: ArtifactDataKeyCache = new Map();
        const socketParams = {
            encryption: (harness.sync as unknown as { encryption: Parameters<typeof handleUpdateContainer>[0]['encryption'] }).encryption,
            artifactDataKeys,
            applySessions: (rows: Parameters<ReturnType<typeof storage.getState>['applySessions']>[0]) => storage.getState().applySessions(rows),
            fetchSessions: noTranscript, applyMessages: noTranscript, onSessionVisible: noTranscript,
            isSessionMessagesLoaded: () => false, getSessionMaterializedMaxSeq: () => 0,
            markSessionMaterializedMaxSeq: noTranscript, onMessageGapDetected: noTranscript,
            assumeUsers: async () => {}, applyTodoSocketUpdates: async () => {},
            invalidateMachines: () => {}, invalidateSessions: noTranscript, invalidateArtifacts: () => {},
            invalidateFriends: () => {}, invalidateFriendRequests: () => {}, invalidateFeed: () => {},
            invalidateAutomations: () => {}, invalidateTodos: () => {}, onTaskLifecycleEvent: () => {},
            hydrateSessionById: noTranscript, log: { log: () => {} },
        } satisfies Omit<Parameters<typeof handleUpdateContainer>[0], 'updateData'>;
        await act(async () => {
            await handleUpdateContainer({ ...socketParams, updateData: {
                id: 'new-permission', seq: 2, createdAt: Date.now() + 1000,
                body: { t: 'update-session', id: workerId,
                    metadata: { version: 2, value: JSON.stringify({ v: 1, flavor: 'claude', path: '/tmp/desk-worker', tag: 'ATR-202-next' }) },
                    agentState: { version: 2, value: JSON.stringify({ requests: { next: { tool: 'Bash', arguments: { command: 'yarn test' }, createdAt: Date.now() } } }) },
                    pendingPermissionRequestCount: 1, pendingUserActionRequestCount: 0, pendingRequestObservedAt: Date.now() + 1000,
                },
            } });
            await new Promise(resolve => setTimeout(resolve, 50));
        });
        expect(hook.getCurrent().keys.get(workerId)).toBe('ATR-202');
        expect(hook.getCurrent().waits.items).toEqual([expect.objectContaining({ requestId: 'next', detail: 'yarn test' })]);
        await act(async () => {
            await handleUpdateContainer({ ...socketParams, updateData: {
                id: 'permission-complete', seq: 3, createdAt: Date.now() + 2000,
                body: { t: 'update-session', id: workerId,
                    agentState: { version: 3, value: JSON.stringify({ requests: {}, completedRequests: { next: { tool: 'Bash', arguments: { command: 'yarn test' }, createdAt: Date.now(), completedAt: Date.now() } } }) },
                    pendingPermissionRequestCount: 0, pendingUserActionRequestCount: 0, pendingRequestObservedAt: null,
                },
            } });
            await new Promise(resolve => setTimeout(resolve, 50));
        });
        expect(storage.getState().sessions[workerId].agentStateVersion).toBe(3);
        expect(storage.getState().sessions[workerId].pendingPermissionRequestCount).toBe(0);
        expect(hook.getCurrent().waits.items).toEqual([]);
        expect(hook.getCurrent().waits.count).toBe(0);
        expect(noTranscript).not.toHaveBeenCalled();
        expect(harness.http.mock.calls.map(([path]) => path).filter(path => /\/(messages|turns)(\?|$)/.test(path))).toEqual([]);
        expect(storage.getState().sessionMessages[workerId]?.isLoaded).not.toBe(true);

    });
});
