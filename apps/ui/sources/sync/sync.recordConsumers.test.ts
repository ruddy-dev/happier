import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDeferred, createSessionFixture } from '@/dev/testkit';
import { buildSessionListRenderableFromSession } from '@/sync/domains/session/listing/sessionListRenderable';
import { storage } from '@/sync/domains/state/storage';
import { getActiveServerSnapshot } from '@/sync/domains/server/serverRuntime';
import { installSessionRecordHarness, jsonResponse, plainWorkerRecord } from '@/ignorePrevious/testkit/sessionRecordHarness';
import { registerSessionRealtimeRecordConsumer } from './runtime/sessionRealtimeRecordConsumers';
import type { SessionListEncryption } from './engine/sessions/sessionSnapshot';

vi.mock('@/voice/context/voiceHooks', () => ({ voiceHooks: { onAgentRequest: vi.fn(), onSessionOnline: vi.fn(), onSessionOffline: vi.fn() } }));

describe('sync record-only hydration', () => {
    const previous = storage.getState();
    let harness: ReturnType<typeof installSessionRecordHarness>;
    let releases: (() => void)[];
    const register = (id: string, serverId?: string) => {
        const release = registerSessionRealtimeRecordConsumer(id, serverId ?? String(getActiveServerSnapshot().serverId));
        releases.push(release);
        return release;
    };
    beforeEach(() => {
        storage.setState({ sessions: {}, sessionListRenderables: {}, sessionMessages: {} });
        releases = [];
        harness = installSessionRecordHarness([]);
    });
    afterEach(() => {
        releases.forEach(release => release());
        harness.restore();
        storage.setState(previous, true);
    });

    it('requires registered snapshot rows without changing hidden nonconsumer eligibility', async () => {
        const rows = [plainWorkerRecord('snapshot-record'), plainWorkerRecord('snapshot-hidden')];
        harness.restore();
        harness = installSessionRecordHarness(rows);
        register('snapshot-record', String(getActiveServerSnapshot().serverId));
        await harness.sync.refreshSessions({ awaitSessionListHydration: true });
        expect(storage.getState().sessions['snapshot-record']?.metadata?.tag).toBe('ATR-101-build');
        expect(storage.getState().sessions['snapshot-hidden']).toBeUndefined();
        expect(harness.http.mock.calls.some(([path]) => /\/(messages|turns)(\?|$)/.test(path))).toBe(false);
    });

    it('F1 settles sessionsSync once despite a desk-only exact failure and advances pagination', async () => {
        vi.useFakeTimers();
        const originalHttp = harness.http.getMockImplementation()!;
        let fail = true;
        harness.http.mockImplementation(async path => {
            const url = new URL(path, 'http://localhost');
            if (url.pathname === '/v2/sessions') return jsonResponse({ sessions: [], nextCursor: 'next-page', hasNext: true });
            if (url.pathname === '/v2/sessions/failed-worker') return fail
                ? jsonResponse({ error: 'unavailable' }, 503)
                : jsonResponse({ session: plainWorkerRecord('failed-worker') });
            if (url.pathname === '/v2/sessions/healthy-worker') return jsonResponse({ session: plainWorkerRecord('healthy-worker') });
            return originalHttp(path);
        });
        register('failed-worker');
        register('healthy-worker');
        const settled = vi.fn();
        // No await:true: this is the real InvalidateSync owner, including its backoff.
        const refresh = harness.sync.refreshSessions().then(settled);
        const snapshotCalls = () => harness.http.mock.calls.filter(([path]) => new URL(path, 'http://localhost').searchParams.get('includeActive') === 'true');
        try {
            await vi.advanceTimersByTimeAsync(100);
            expect.soft(settled).toHaveBeenCalledTimes(1);
            expect.soft(storage.getState().sessions['healthy-worker']).toBeDefined();
            expect.soft(harness.sync as unknown).toMatchObject({ sessionListNextCursor: 'next-page', sessionListHasMore: true });
            // Cross the whole maximum backoff window; no new snapshot or exact retry.
            await vi.advanceTimersByTimeAsync(60_000);
            expect.soft(snapshotCalls()).toHaveLength(1);
            expect.soft(settled).toHaveBeenCalledTimes(1);
            expect.soft(harness.http.mock.calls.filter(([path]) => path === '/v2/sessions/failed-worker')).toHaveLength(1);
        } finally {
            // Let the unpatched RED implementation drain its retry before restoring the singleton.
            fail = false;
            await vi.advanceTimersByTimeAsync(60_000);
            await refresh;
            vi.useRealTimers();
        }
    });

    it.each(['explicit', 'pinned', 'attention'] as const)('F1 preserves required-record failure for a %s desk consumer', async requirement => {
        const originalHttp = harness.http.getMockImplementation()!;
        const serverId = String(getActiveServerSnapshot().serverId);
        // Force the organization boundary to finish before the snapshot reads required ids.
        storage.setState({ sessionOrganizationSnapshotVersionByServerId: {} });
        harness.http.mockImplementation(async path => {
            if (path === '/v2/sessions/required-failure') return jsonResponse({ error: 'unavailable' }, 503);
            if (new URL(path, 'http://localhost').pathname === '/v2/session-organization') return jsonResponse({ snapshot: {
                schemaVersion: 1, version: 2,
                pins: requirement === 'pinned' ? [{ sessionId: 'required-failure', sortKey: 'rank-a', pinnedAt: 1 }] : [],
                attentionStandings: requirement === 'attention' ? [{ sessionId: 'required-failure', standing: true, updatedAt: 1 }] : [],
                folders: [], folderAssignments: [], tags: [], tagAssignments: [], orderEntries: [], labels: [],
            } });
            return originalHttp(path);
        });
        register('required-failure', serverId);
        const owner = harness.sync as unknown as {
            fetchSessions: (options: { requiredHydrationSessionIds?: string[] }) => Promise<void>;
        };
        await expect(owner.fetchSessions({
            requiredHydrationSessionIds: requirement === 'explicit' ? ['required-failure'] : [],
        })).rejects.toThrow('Required session shell hydration failed');
    });

    it.each(['desk-only', 'desk-only-last', 'pinned', 'attention', 'explicit'] as const)('L4 handles an in-page %s hydration throw through sessionsSync', async requirement => {
        vi.useFakeTimers();
        const softRequired = requirement === 'desk-only' || requirement === 'desk-only-last';
        const failure = new Error('Session crypto unavailable');
        let fail = true;
        harness.restore();
        const rows = [
            { ...plainWorkerRecord('throwing-row'), encryptionMode: 'e2ee' as const, dataEncryptionKey: 'test-envelope' },
            plainWorkerRecord('healthy-row'),
        ];
        if (requirement === 'desk-only-last') rows.reverse();
        harness = installSessionRecordHarness(rows);
        const owner = harness.sync as unknown as {
            encryption: SessionListEncryption;
            fetchSessions: (options: { requiredHydrationSessionIds?: string[] }) => Promise<void>;
        };
        // Fake the crypto boundary, not the row hydrator. Key preparation succeeds;
        // acquiring the row's crypto throws inside the real hydration task.
        owner.encryption = {
            ...owner.encryption,
            decryptEncryptionKeys: async values => values.map(() => new Uint8Array(32)),
            initializeSessions: async () => {},
            getSessionEncryption: () => { if (fail) throw failure; return null; },
        };
        const originalHttp = harness.http.getMockImplementation()!;
        storage.setState({ sessionOrganizationSnapshotVersionByServerId: {} });
        harness.http.mockImplementation(async path => {
            const url = new URL(path, 'http://localhost');
            if (url.pathname === '/v2/sessions') return jsonResponse({ sessions: rows, nextCursor: 'next-page', hasNext: true });
            if (url.pathname === '/v2/session-organization') return jsonResponse({ snapshot: {
                schemaVersion: 1, version: 2,
                pins: requirement === 'pinned' ? [{ sessionId: 'throwing-row', sortKey: 'rank-a', pinnedAt: 1 }] : [],
                attentionStandings: requirement === 'attention' ? [{ sessionId: 'throwing-row', standing: true, updatedAt: 1 }] : [],
                folders: [], folderAssignments: [], tags: [], tagAssignments: [], orderEntries: [], labels: [],
            } });
            return originalHttp(path);
        });
        register('throwing-row');
        register('healthy-row');
        const settled = vi.fn();
        let refresh: Promise<void> | undefined;
        const snapshotCalls = () => harness.http.mock.calls.filter(([path]) => new URL(path, 'http://localhost').searchParams.get('includeActive') === 'true');
        try {
            if (!softRequired) {
                // Inspect the actual rejection as well as the wrapper's retry behavior.
                await expect(owner.fetchSessions({
                    requiredHydrationSessionIds: requirement === 'explicit' ? ['throwing-row'] : [],
                })).rejects.toBe(failure);
                if (requirement === 'explicit') return;
                harness.http.mockClear();
            }
            refresh = harness.sync.refreshSessions().then(settled);
            await vi.advanceTimersByTimeAsync(100);
            if (softRequired) {
                expect.soft(settled).toHaveBeenCalledTimes(1);
                expect.soft(storage.getState().sessions['healthy-row']).toBeDefined();
                expect.soft(harness.sync as unknown).toMatchObject({ sessionListNextCursor: 'next-page', sessionListHasMore: true });
                await vi.advanceTimersByTimeAsync(60_000);
                expect.soft(snapshotCalls()).toHaveLength(1);
                expect.soft(settled).toHaveBeenCalledTimes(1);
                expect.soft(harness.http.mock.calls.filter(([path]) => path === '/v2/sessions/throwing-row')).toHaveLength(0);
            } else {
                expect(settled).not.toHaveBeenCalled();
                await vi.advanceTimersByTimeAsync(60_000);
                expect(snapshotCalls().length).toBeGreaterThan(1);
            }
        } finally {
            fail = false;
            await vi.advanceTimersByTimeAsync(60_000);
            await refresh;
            vi.useRealTimers();
        }
    });

    it('L1 refreshes changed loaded records on catch-up without reading unchanged desk records', async () => {
        const originalHttp = harness.http.getMockImplementation()!;
        let version = 1;
        harness.http.mockImplementation(async path => {
            const id = path.match(/^\/v2\/sessions\/(changed|unchanged)$/)?.[1];
            if (id) return jsonResponse({ session: {
                ...plainWorkerRecord(id), metadataVersion: version,
                metadata: JSON.stringify({ path: '/work', tag: `ATR-${version}-worker` }),
            } });
            return originalHttp(path);
        });
        register('changed');
        register('unchanged');
        await harness.sync.refreshSessions({ awaitSessionListHydration: true });
        harness.http.mockClear();
        version = 2;
        const owner = harness.sync as unknown as {
            fetchSessions: (options: { requiredHydrationSessionIds: string[]; hydrationTelemetrySource: 'changesCatchUp' }) => Promise<void>;
        };
        // changesApplier supplies the changed ids, independent of record-consumer demand.
        await owner.fetchSessions({ requiredHydrationSessionIds: ['changed'], hydrationTelemetrySource: 'changesCatchUp' });
        expect(storage.getState().sessions.changed?.metadata?.tag).toBe('ATR-2-worker');
        expect(storage.getState().sessions.unchanged?.metadata?.tag).toBe('ATR-1-worker');
        expect(harness.http.mock.calls.filter(([path]) => /^\/v2\/sessions\/(changed|unchanged)$/.test(path)).map(([path]) => path)).toEqual(['/v2/sessions/changed']);
    });

    it('F2 skips off-page exact reads on append and loaded replace, but refreshes on resume', async () => {
        const originalHttp = harness.http.getMockImplementation()!;
        let version = 1;
        harness.http.mockImplementation(async path => {
            if (path === '/v2/sessions/missing-off-page') return jsonResponse({ error: 'unavailable' }, 503);
            if (path === '/v2/sessions/off-page') return jsonResponse({ session: {
                ...plainWorkerRecord('off-page'), metadataVersion: version,
                metadata: JSON.stringify({ path: '/work', tag: `ATR-${version}-worker` }),
            } });
            return originalHttp(path);
        });
        register('off-page');
        const releaseMissing = register('missing-off-page');
        await harness.sync.refreshSessions({ awaitSessionListHydration: true });
        const owner = harness.sync as unknown as {
            sessionListNextCursor: string | null; sessionListHasMore: boolean; resumeInFlight: Promise<void> | null;
        };
        harness.http.mockClear();
        owner.sessionListNextCursor = 'next-page';
        owner.sessionListHasMore = true;
        await harness.sync.fetchMoreSessions();
        expect.soft(harness.http.mock.calls.filter(([path]) => /\/v2\/sessions\/(missing-)?off-page$/.test(path))).toHaveLength(0);
        releaseMissing();
        harness.http.mockClear();
        await harness.sync.refreshSessions({ awaitSessionListHydration: true });
        expect.soft(harness.http.mock.calls.filter(([path]) => path === '/v2/sessions/off-page')).toHaveLength(0);
        harness.http.mockClear();
        version = 2;
        // Resume owns this in-flight marker. Exercise its sessionsSync leg without
        // mocking orchestration or invoking unrelated purchase/profile transports.
        owner.resumeInFlight = Promise.resolve();
        try { await harness.sync.refreshSessions(); }
        finally { owner.resumeInFlight = null; }
        expect(storage.getState().sessions['off-page']?.metadata?.tag).toBe('ATR-2-worker');
        expect(harness.http.mock.calls.filter(([path]) => path === '/v2/sessions/off-page')).toHaveLength(1);
    });

    it('F6 awaits all record consumers beyond the non-awaited background hydration limit', async () => {
        harness.restore();
        const rows = Array.from({ length: 3 }, (_, i) => plainWorkerRecord(`required-${i}`));
        harness = installSessionRecordHarness(rows);
        const owner = harness.sync as unknown as { syncTuning: { sessionListBackgroundHydrationMaxRows: number } };
        const previousLimit = owner.syncTuning.sessionListBackgroundHydrationMaxRows;
        owner.syncTuning.sessionListBackgroundHydrationMaxRows = 1;
        rows.forEach(row => register(row.id));
        try {
            await harness.sync.refreshSessions({ awaitSessionListHydration: false });
            expect(rows.map(row => storage.getState().sessions[row.id]?.metadata?.tag)).toEqual([
                'ATR-101-build', 'ATR-101-build', 'ATR-101-build',
            ]);
            expect(harness.http.mock.calls.filter(([path]) => /^\/v2\/sessions\/required-/.test(path))).toEqual([]);
        } finally { owner.syncTuning.sessionListBackgroundHydrationMaxRows = previousLimit; }
    });

    it.each(['late', 'snapshot'] as const)('refreshes demanded stale metadata through %s demand while reusing current loaded records', async demand => {
        if (demand === 'late') await harness.sync.refreshSessions({ awaitSessionListHydration: true });
        const serverId = String(getActiveServerSnapshot().serverId);
        const stale = createSessionFixture({ id: 'demand-stale', serverId, metadataVersion: 1 });
        const current = createSessionFixture({ id: 'demand-current', serverId, metadataVersion: 2 });
        storage.getState().applySessions([stale, current]);
        const loadedCurrent = storage.getState().sessions[current.id];
        storage.getState().replaceSessionListRenderables([
            buildSessionListRenderableFromSession({ ...stale, metadataVersion: 2 }),
            buildSessionListRenderableFromSession(current),
        ], { coversWholeList: true });
        const response = createDeferred<Response>();
        const original = harness.http.getMockImplementation()!;
        harness.http.mockImplementation(path => path === '/v2/sessions/demand-stale' ? response.promise : original(path));
        register(stale.id);
        register(stale.id);
        register(current.id);
        const snapshot = demand === 'snapshot' ? harness.sync.refreshSessions({ awaitSessionListHydration: true }) : undefined;
        await vi.waitFor(() => expect(harness.http.mock.calls.filter(([path]) => path === '/v2/sessions/demand-stale')).toHaveLength(1));
        response.resolve(jsonResponse({ session: { ...plainWorkerRecord(stale.id), metadataVersion: 2 } }));
        await snapshot;
        await vi.waitFor(() => expect(storage.getState().sessions[stale.id]?.metadataVersion).toBe(2));
        expect(storage.getState().sessions[current.id]).toBe(loadedCurrent);
        expect(harness.http.mock.calls.filter(([path]) => path === '/v2/sessions/demand-current')).toHaveLength(0);
        register(stale.id)();
        await new Promise(resolve => setTimeout(resolve, 30));
        expect(harness.http.mock.calls.filter(([path]) => path === '/v2/sessions/demand-stale')).toHaveLength(1);
    });

    it('keeps failed stale demand observable without looping, and retries through an explicit snapshot', async () => {
        await harness.sync.refreshSessions({ awaitSessionListHydration: true });
        const stale = createSessionFixture({ id: 'stale-retry', serverId: String(getActiveServerSnapshot().serverId), metadataVersion: 1 });
        storage.getState().applySessions([stale]);
        storage.getState().replaceSessionListRenderables([
            buildSessionListRenderableFromSession({ ...stale, metadataVersion: 2 }),
        ], { coversWholeList: true });
        const failureLog = vi.spyOn(console, 'error').mockImplementation(() => {});
        const original = harness.http.getMockImplementation()!;
        let fail = true;
        harness.http.mockImplementation(async path => path === '/v2/sessions/stale-retry'
            ? fail ? jsonResponse({ error: 'unavailable' }, 503)
                : jsonResponse({ session: { ...plainWorkerRecord(stale.id), metadataVersion: 2 } })
            : original(path));
        try {
            register(stale.id);
            await vi.waitFor(() => expect(failureLog).toHaveBeenCalledWith(expect.stringContaining('Sync.recordConsumerHydration'), expect.any(Error)));
            register(stale.id)();
            await new Promise(resolve => setTimeout(resolve, 30));
            expect(storage.getState().sessions[stale.id]?.metadataVersion).toBe(1);
            expect(harness.http.mock.calls.filter(([path]) => path === '/v2/sessions/stale-retry')).toHaveLength(1);
            fail = false;
            await harness.sync.refreshSessions({ awaitSessionListHydration: true });
            expect(storage.getState().sessions[stale.id]?.metadataVersion).toBe(2);
            expect(harness.http.mock.calls.filter(([path]) => path === '/v2/sessions/stale-retry')).toHaveLength(2);
        } finally { failureLog.mockRestore(); }
    });

    it('fetches only missing late records, dedupes registrations, caps at four, and does not retry failures when other demand changes', async () => {
        await harness.sync.refreshSessions({ awaitSessionListHydration: true });
        const gates = new Map<string, ReturnType<typeof createDeferred<void>>>();
        let active = 0;
        let peak = 0;
        const exactIds: string[] = [];
        const originalHttp = harness.http.getMockImplementation()!;
        harness.http.mockImplementation(async path => {
            const match = path.match(/^\/v2\/sessions\/([^/?]+)$/);
            if (!match) return originalHttp(path);
            const id = match[1];
            exactIds.push(id);
            active += 1;
            peak = Math.max(peak, active);
            try {
                await gates.get(id)?.promise;
                if (id === 'late-failed') return jsonResponse({ error: 'unavailable' }, 503);
                return jsonResponse({ session: plainWorkerRecord(id) });
            } finally { active -= 1; }
        });
        for (let i = 0; i < 6; i++) gates.set(`late-${i}`, createDeferred<void>());
        for (let i = 0; i < 6; i++) register(`late-${i}`);
        register('late-0');
        register('late-failed');
        register('other-server', 'unrelated-server');
        await vi.waitFor(() => expect(exactIds).toHaveLength(4));
        expect(peak).toBe(4);
        gates.get('late-0')!.resolve();
        await vi.waitFor(() => expect(exactIds).toHaveLength(5));
        for (const gate of gates.values()) gate.resolve();
        await vi.waitFor(() => expect(exactIds).toHaveLength(7));
        await vi.waitFor(() => expect(storage.getState().sessions['late-5']).toBeDefined());
        expect(new Set(exactIds).size).toBe(7);
        expect(peak).toBe(4);
        // Same membership, even with an extra ref, cannot create a failure retry loop.
        register('late-failed')();
        await new Promise(resolve => setTimeout(resolve, 30));
        expect(exactIds.filter(id => id === 'late-failed')).toHaveLength(1);
        register('late-new');
        await vi.waitFor(() => expect(storage.getState().sessions['late-new']).toBeDefined());
        expect(exactIds.filter(id => id === 'late-failed')).toHaveLength(1);
        expect(exactIds.filter(id => id === 'late-0')).toHaveLength(1);
        expect(harness.http.mock.calls.some(([path]) => /\/(messages|turns)(\?|$)/.test(path))).toBe(false);
    });
});
