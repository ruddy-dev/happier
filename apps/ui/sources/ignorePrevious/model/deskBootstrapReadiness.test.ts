import { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDeferred, renderHook, standardCleanup } from '@/dev/testkit';

// Applying a permission request can notify the external voice service.
vi.mock('@/voice/context/voiceHooks', () => ({
    voiceHooks: { onAgentRequest: vi.fn(), onSessionOnline: vi.fn(), onSessionOffline: vi.fn() },
}));

describe('desk readiness through public cold bootstrap', () => {
    let cleanup: (() => void) | undefined;

    beforeEach(() => {
        vi.resetModules();
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    });

    afterEach(() => {
        standardCleanup();
        cleanup?.();
        cleanup = undefined;
        vi.clearAllTimers();
        vi.useRealTimers();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    async function setupBootstrap(empty = false, initialAppState: 'active' | 'background' = 'active') {
        const { AppState } = await import('react-native');
        const { createReactNativeAppStateEmitter } = await import('@/dev/testkit/mocks/reactNative');
        const appState = createReactNativeAppStateEmitter(initialAppState);
        const restoreAppState = appState.install(AppState);
        const { storage } = await import('@/sync/domains/state/storage');
        const { installSessionRecordHarness, plainWorkerRecord, jsonResponse } = await import('../testkit/sessionRecordHarness');
        const { Encryption } = await import('@/sync/encryption/encryption');
        const { profileDefaults } = await import('@/sync/domains/profiles/profile');
        const { useDeskSessions } = await import('../useDeskSessions');
        const { useDeskWaits, useDeskWaitsActivity } = await import('./useDeskWaits');
        const { useDeskWorkerRecordConsumers } = await import('./useDeskWorkerRecordConsumers');
        const { apiSocket } = await import('@/sync/api/session/apiSocket');

        const previous = storage.getState();
        const workerId = 'bootstrap-worker';
        const harness = installSessionRecordHarness(empty ? [] : [plainWorkerRecord(workerId)]);
        // This is the real reset used on disconnect/server switch. No readiness setter is
        // invoked by the test: only bootstrap may publish ready after this cold reset.
        harness.sync.disconnectServer();
        cleanup = () => {
            harness.sync.disconnectServer();
            harness.restore();
            restoreAppState();
            storage.setState(previous, true);
        };

        // restore subscribes to the socket; this test exercises HTTP bootstrap without a
        // live transport. Preserve the real request boundary installed by the harness.
        vi.spyOn(apiSocket, 'connect').mockImplementation(() => {});
        const defaultHttp = harness.http.getMockImplementation()!;
        const firstList = createDeferred<void>();
        let listResponse = async (path: string) => {
            await firstList.promise;
            return defaultHttp(path);
        };
        const unexpectedPaths: string[] = [];
        let listRequested = false;
        let listReleased = false;
        harness.http.mockImplementation(async (path) => {
            const pathname = new URL(path, 'http://localhost').pathname;
            if (pathname === '/v2/sessions' || pathname === '/v2/sessions/active') {
                listRequested = true;
                return listResponse(path);
            }
            // Valid responses for bootstrap's other HTTP owners. Optional server features
            // are unsupported, using the production 404 negotiation path.
            if (pathname === '/v1/features') return jsonResponse({ error: 'not_found' }, 404);
            if (pathname === '/v2/changes') return jsonResponse({ error: 'not_found' }, 404);
            if (pathname === '/v1/account/encryption') return jsonResponse({ mode: 'plain', updatedAt: 0 });
            if (pathname === '/v2/account/settings') return jsonResponse({ content: { t: 'plain', v: {} }, version: 1 });
            if (pathname === '/v1/account/profile') return jsonResponse({ ...profileDefaults, id: 'bootstrap-account' });
            if (pathname === '/v1/machines' || pathname === '/v1/artifacts') return jsonResponse([]);
            if (pathname === '/v1/kv') return jsonResponse({ items: [], nextCursor: null, hasNext: false });
            if (pathname === '/v1/feed') return jsonResponse({ items: [], hasMore: false });
            try {
                return await defaultHttp(path);
            } catch (error) {
                unexpectedPaths.push(pathname);
                throw error;
            }
        });

        const hook = await renderHook(() => {
            const desk = useDeskSessions();
            useDeskWorkerRecordConsumers(desk.list, null);
            return { desk, waits: useDeskWaitsActivity(), waiting: useDeskWaits() };
        });
        const startedAt = Date.now();
        const observe = () => ({
            elapsedMs: Date.now() - startedAt,
            listRequested,
            listReleased,
            isDataReady: storage.getState().isDataReady,
            renderables: Object.keys(storage.getState().sessionListRenderables).length,
            fullRecords: Object.keys(storage.getState().sessions).length,
            deskReady: hook.getCurrent().desk.ready,
            deskRows: hook.getCurrent().desk.list.length,
            waitingCount: hook.getCurrent().waits.count,
            connecting: !hook.getCurrent().waiting.ready,
        });
        expect(observe()).toMatchObject({
            isDataReady: false, renderables: 0, fullRecords: 0,
            deskReady: false, deskRows: 0, waitingCount: null,
        });

        const token = `hdr.${btoa(JSON.stringify({ sub: 'bootstrap-account' }))}.sig`;
        const credentials = { token };
        return {
            ...harness, storage, hook, workerId, observe, unexpectedPaths, credentials, appState,
            setListResponse: (response: typeof listResponse) => { listResponse = response; },
            defaultListResponse: defaultHttp,
            releaseList: () => { listReleased = true; firstList.resolve(); },
            start: async () => {
                await act(async () => {
                    await harness.sync.restore(credentials, Encryption.createWithoutKeyMaterial());
                    await vi.advanceTimersByTimeAsync(0);
                });
                expect(listRequested).toBe(initialAppState === 'active');
            },
        };
    }

    it.each([
        { name: 'slow first list stays unknown beyond the bootstrap wait budget', slow: true, empty: false },
        { name: 'timely first list becomes ready with the loaded worker', slow: false, empty: false },
        { name: 'a completed empty first list becomes a known zero', slow: false, empty: true },
    ])('$name', async ({ name, slow, empty }) => {
        const harness = await setupBootstrap(empty);
        const { storage, hook, workerId, observe, unexpectedPaths } = harness;
        await harness.start();
        const waitBudgetMs = harness.sync.getSyncTuning().invalidateSyncAwaitTimeoutMs;
        const beforeResponse = [];
        if (slow) {
            await act(async () => { await vi.advanceTimersByTimeAsync(waitBudgetMs - 1); });
            beforeResponse.push(observe());
            expect(observe()).toMatchObject({
                isDataReady: false, deskReady: false, waitingCount: null,
                renderables: 0, fullRecords: 0, listReleased: false,
            });
            await act(async () => { await vi.advanceTimersByTimeAsync(2); });
            beforeResponse.push(observe());
            // Soft assertions preserve the original unknown-before-first-response contract
            // while allowing the same run to prove the delayed fixture eventually loads.
            expect.soft(observe()).toMatchObject({
                isDataReady: false, deskReady: false, waitingCount: null,
                renderables: 0, fullRecords: 0, listReleased: false,
            });
        }

        await act(async () => {
            harness.releaseList();
            await vi.advanceTimersByTimeAsync(0);
        });
        await act(async () => {
            await vi.waitFor(() => {
                expect(storage.getState().isDataReady).toBe(true);
                expect(Object.keys(storage.getState().sessionListRenderables)).toEqual(empty ? [] : [workerId]);
                if (!empty) expect(storage.getState().sessions[workerId]?.metadata?.tag).toBe('ATR-101-build');
            });
        });
        expect(hook.getCurrent().desk.ready).toBe(true);
        expect(hook.getCurrent().desk.list.map(row => row.id)).toEqual(empty ? [] : [workerId]);
        expect(hook.getCurrent().waits.count).toBe(empty ? 0 : 1);
        expect(unexpectedPaths).toEqual([]);
        expect(storage.getState().syncError).toBeNull();
        console.info('cold bootstrap evidence', { name, waitBudgetMs, beforeResponse, loaded: observe() });
    });

    it.each([
        { name: 'automatic retry after a transient failure', status: 503 },
        { name: 'explicit retry after a non-retryable failure', status: 400 },
    ])('stays unknown until $name succeeds', async ({ status }) => {
        const harness = await setupBootstrap();
        const { jsonResponse } = await import('../testkit/sessionRecordHarness');
        const retryResponse = createDeferred<void>();
        let failed = false;
        harness.setListResponse(async (path) => {
            if (!failed) {
                failed = true;
                return jsonResponse({ error: 'synthetic_failure' }, status);
            }
            await retryResponse.promise;
            return harness.defaultListResponse(path);
        });
        await harness.start();
        await act(async () => {
            await vi.advanceTimersByTimeAsync(harness.sync.getSyncTuning().invalidateSyncAwaitTimeoutMs + 1);
        });
        expect(failed).toBe(true);
        expect.soft(harness.observe()).toMatchObject({
            isDataReady: false, deskReady: false, waitingCount: null, connecting: true,
        });
        const refresh = status === 400 ? harness.sync.refreshSessions() : Promise.resolve();
        await act(async () => {
            retryResponse.resolve();
            await vi.advanceTimersByTimeAsync(0);
            await refresh;
            await vi.waitFor(() => expect(harness.storage.getState().isDataReady).toBe(true));
        });
        expect(harness.observe()).toMatchObject({ deskReady: true, waitingCount: 1, connecting: false });
        expect(harness.unexpectedPaths).toEqual([]);
    });

    it.each([false, true])('never publishes ready after disconnect, with the wait budget already expired: %s', async (expired) => {
        const harness = await setupBootstrap();
        await harness.start();
        if (expired) {
            await act(async () => {
                await vi.advanceTimersByTimeAsync(harness.sync.getSyncTuning().invalidateSyncAwaitTimeoutMs + 1);
            });
        }
        await act(async () => {
            harness.sync.disconnectServer();
            harness.releaseList();
            await vi.advanceTimersByTimeAsync(harness.sync.getSyncTuning().invalidateSyncAwaitTimeoutMs + 1);
        });
        expect(harness.observe()).toMatchObject({
            isDataReady: false, deskReady: false, waitingCount: null, connecting: true, renderables: 0,
        });
        expect(harness.unexpectedPaths).toEqual([]);
    });

    it.each(['old-first', 'new-first'] as const)('isolates a replacement server bootstrap when responses finish %s', async (order) => {
        const harness = await setupBootstrap();
        const { upsertAndActivateServer } = await import('@/sync/domains/server/serverRuntime');
        const { jsonResponse } = await import('../testkit/sessionRecordHarness');
        await harness.start();
        const replacementList = createDeferred<void>();
        let replacementRequested = false;
        harness.setListResponse(async () => {
            replacementRequested = true;
            await replacementList.promise;
            return jsonResponse({ sessions: [], nextCursor: null, hasNext: false });
        });
        await act(async () => {
            upsertAndActivateServer({ serverUrl: 'http://localhost:53289', scope: 'tab' });
            await harness.sync.switchServer(harness.credentials);
            await vi.advanceTimersByTimeAsync(0);
        });
        // The new scope must start its own list while the obsolete HTTP response is still held.
        expect.soft(replacementRequested).toBe(true);
        if (order === 'old-first') {
            await act(async () => { harness.releaseList(); await vi.advanceTimersByTimeAsync(0); });
            expect.soft(harness.observe()).toMatchObject({
                isDataReady: false, deskReady: false, waitingCount: null, connecting: true, renderables: 0,
            });
        }
        await act(async () => {
            replacementList.resolve();
            await vi.advanceTimersByTimeAsync(harness.sync.getSyncTuning().invalidateSyncAwaitTimeoutMs + 1);
        });
        expect.soft(harness.observe()).toMatchObject({
            isDataReady: true, deskReady: true, waitingCount: 0, connecting: false, renderables: 0,
        });
        if (order === 'new-first') {
            await act(async () => { harness.releaseList(); await vi.advanceTimersByTimeAsync(0); });
            expect(harness.observe()).toMatchObject({
                isDataReady: true, deskReady: true, waitingCount: 0, connecting: false, renderables: 0,
            });
        }
        expect(harness.unexpectedPaths).toEqual([]);
    });


    it('resumes public bootstrap, loads artifacts before ready, and tolerates unavailable draft storage', async () => {
        const harness = await setupBootstrap(true, 'background');
        const artifacts = createDeferred<void>();
        const http = harness.http.getMockImplementation()!;
        harness.http.mockImplementation(async (path) => {
            if (new URL(path, 'http://localhost').pathname === '/v1/artifacts') await artifacts.promise;
            return http(path);
        });
        harness.releaseList();
        await harness.start();
        expect(harness.observe()).toMatchObject({ listRequested: false, isDataReady: false, connecting: true });
        const { getPersistenceStorage } = await import('@/sync/domains/state/persistence');
        const draftStorage = getPersistenceStorage();
        const readString = draftStorage.getString.bind(draftStorage);
        let draftReadFailed = false;
        // Fail the persistence boundary used by bootstrap's real draft migration,
        // after restore has loaded the profile's local state.
        vi.spyOn(draftStorage, 'getString').mockImplementation((key) => {
            if (key.startsWith('session-drafts')) {
                draftReadFailed = true;
                throw new Error('Synthetic draft storage unavailable');
            }
            return readString(key);
        });
        await act(async () => {
            harness.appState.emit('active');
            await vi.advanceTimersByTimeAsync(0);
        });
        expect(harness.observe()).toMatchObject({ listRequested: true, isDataReady: false, connecting: true });
        expect(harness.storage.getState().artifactsLoaded).toBe(false);
        await act(async () => {
            artifacts.resolve();
            await vi.advanceTimersByTimeAsync(0);
            await vi.waitFor(() => expect(harness.storage.getState().isDataReady).toBe(true));
        });
        expect(draftReadFailed).toBe(true);
        expect(harness.storage.getState().artifactsLoaded).toBe(true);
        expect(harness.observe()).toMatchObject({ deskReady: true, waitingCount: 0, connecting: false });
        expect(harness.unexpectedPaths).toEqual([]);
    });

});
