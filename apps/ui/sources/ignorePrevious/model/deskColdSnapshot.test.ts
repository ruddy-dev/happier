import { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { V2SessionRecord } from '@happier-dev/protocol';

import { renderHook, standardCleanup } from '@/dev/testkit';
import { storage } from '@/sync/domains/state/storage';
import { fetchAndApplySessions, type SessionListEncryption } from '@/sync/engine/sessions/sessionSnapshot';

import { useDeskSessions } from '../useDeskSessions';
import { useDeskWaits } from './useDeskWaits';
import { useIssueKeys } from './useIssueKeys';

// Voice is an external side effect of applying a newly hydrated permission request.
vi.mock('@/voice/context/voiceHooks', () => ({ voiceHooks: { onAgentRequest: vi.fn() } }));

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

// Plain sessions need no keys. Any attempt to decrypt this wire payload is a test failure.
const encryption: SessionListEncryption = {
    decryptEncryptionKeys: async () => { throw new Error('Plain snapshot requested encryption keys'); },
    initializeSessions: async () => { throw new Error('Plain snapshot initialized encryption'); },
    removeSessionEncryption: () => {},
    getSessionEncryption: () => null,
};

describe('desk details through the session snapshot owner', () => {
    let previous: ReturnType<typeof storage.getState>;
    beforeEach(() => {
        previous = storage.getState();
        storage.setState({ sessions: {}, sessionListRenderables: {}, sessionMessages: {}, sessionListViewData: null });
        vi.useFakeTimers();
    });
    afterEach(() => {
        standardCleanup();
        storage.setState(previous, true);
        vi.useRealTimers();
    });

    // ATR-28 follow-up: retain the cold case RED until the lead scopes the app-wide loading fix.
    it.each([
        { name: 'cold list snapshot without a session opened', required: false },
        { name: 'control: the same payload with explicitly required hydration', required: true },
    ])('$name exposes the tag and actionable request', async ({ required }) => {
        const hook = await renderHook(() => ({ keys: useIssueKeys(useDeskSessions()), waits: useDeskWaits() }));
        await act(async () => {
            await fetchAndApplySessions({
                credentials: { token: 'test-token' },
                encryption,
                sessionDataKeys: new Map(),
                request: async () => new Response(JSON.stringify({ sessions: [plainWaitingWorker()], nextCursor: null, hasNext: false }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                }),
                getExistingSession: (id) => storage.getState().sessions[id] ?? null,
                getCurrentSessionListRenderable: (id) => storage.getState().sessionListRenderables[id] ?? null,
                applySessionListRenderables: (rows) => storage.getState().replaceSessionListRenderables(rows),
                applySessionListRenderablePatches: (patches) => storage.getState().applySessionListRenderablePatches(patches),
                applySessions: (sessions) => storage.getState().applySessions(sessions),
                requiredHydrationSessionIds: required ? [workerId] : [],
                awaitSessionListHydration: required,
                repairInvalidReadStateV1: async () => {},
                log: { log: () => {} },
            });
            await vi.runAllTimersAsync();
            storage.getState().applyReady();
        });

        expect(storage.getState().sessionListRenderables[workerId]?.hasPendingPermissionRequests).toBe(true);
        expect(hook.getCurrent().waits.count).toBe(1);
        expect.soft(hook.getCurrent().keys.get(workerId)).toBe('ATR-101');
        expect.soft(hook.getCurrent().waits.items).toEqual([
            expect.objectContaining({ requestId, detail: 'yarn db:migrate', disabledReason: null }),
        ]);
        expect.soft(hook.getCurrent().waits.unloaded).toEqual([]);
    });
});
