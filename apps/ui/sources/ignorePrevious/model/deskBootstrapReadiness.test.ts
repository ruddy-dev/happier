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
        vi.stubEnv('EXPO_PUBLIC_IP_COORDINATOR_PATH', '/tmp/desk-coordinator');
    });

    afterEach(() => {
        standardCleanup();
        cleanup?.();
        cleanup = undefined;
        vi.clearAllTimers();
        vi.useRealTimers();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        vi.unstubAllEnvs();
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
        const { useCoordinatorId } = await import('./useCoordinatorId');
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
            const coordinatorId = useCoordinatorId(desk.list);
            useDeskWorkerRecordConsumers(desk.list, coordinatorId);
            return { desk, coordinatorId, waits: useDeskWaitsActivity(), waiting: useDeskWaits() };
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
            start: async (encryption = Encryption.createWithoutKeyMaterial()) => {
                await act(async () => {
                    await harness.sync.restore(credentials, encryption);
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

    it.each(['delayed', 'timely', 'unreadable', 'disconnect'] as const)(
        'initial encrypted snapshot has coherent desk metadata before readiness: %s', async (mode) => {
            const harness = await setupBootstrap();
            const { Encryption } = await import('@/sync/encryption/encryption');
            const { encodeBase64 } = await import('@/encryption/base64');
            const aes = await import('rn-encryption');
            const { plainWorkerRecord, jsonResponse } = await import('../testkit/sessionRecordHarness');
            // Distinct real per-session AES keys, wrapped for this synthetic account. The
            // reader is cold: only the writer has encrypted/decrypted these records before.
            const secret = new Uint8Array(32).fill(7);
            const writer = await Encryption.create(secret);
            const reader = await Encryption.create(secret);
            const coordinatorId = 'bootstrap-coordinator';
            const rows = await Promise.all([harness.workerId, coordinatorId].map(async (id, index) => {
                const row = plainWorkerRecord(id);
                const key = new Uint8Array(32).fill(index + 11);
                await writer.initializeSessions(new Map([[id, key]]));
                const cipher = writer.getSessionEncryption(id)!;
                const metadata = JSON.parse(row.metadata);
                if (id === coordinatorId) metadata.path = '/tmp/desk-coordinator';
                return {
                    ...row, encryptionMode: 'e2ee' as const,
                    dataEncryptionKey: encodeBase64(await writer.encryptEncryptionKey(key)),
                    metadata: mode === 'unreadable' && id === harness.workerId
                        ? 'invalid-ciphertext' : await cipher.encryptMetadata(metadata),
                    agentState: await cipher.encryptAgentState(id === coordinatorId ? {} : JSON.parse(row.agentState!)),
                    pendingPermissionRequestCount: id === coordinatorId ? 0 : 1,
                };
            }));
            harness.setListResponse(async () => jsonResponse({ sessions: rows, nextCursor: null, hasNext: false }));
            const http = harness.http.getMockImplementation()!;
            harness.http.mockImplementation(async (path) => {
                const pathname = new URL(path, 'http://localhost').pathname;
                const row = rows.find(row => pathname === `/v2/sessions/${row.id}`);
                return row ? jsonResponse({ session: row }) : http(path);
            });
            const gate = createDeferred<void>();
            const entered = createDeferred<void>();
            const decrypt = aes.decryptAsyncAES;
            vi.spyOn(aes, 'decryptAsyncAES').mockImplementation(async (...args) => {
                entered.resolve();
                await gate.promise;
                return decrypt(...args);
            });
            let firstReadyRows: Array<{ id: string; settled: boolean }> | undefined;
            const unsubscribe = harness.storage.subscribe(state => {
                if (!state.isDataReady || firstReadyRows) return;
                firstReadyRows = Object.values(state.sessionListRenderables).map(row => ({
                    id: row.id, settled: row.metadata !== null || row.metadataUnavailable === true,
                }));
            });
            try {
                if (mode === 'timely' || mode === 'unreadable') gate.resolve();
                await harness.start(reader);
                await act(async () => {
                    await entered.promise;
                    await vi.advanceTimersByTimeAsync(harness.sync.getSyncTuning().invalidateSyncAwaitTimeoutMs + 1);
                });
                if (mode === 'delayed' || mode === 'disconnect') {
                    expect.soft(Object.values(harness.storage.getState().sessionListRenderables).map(row => row.metadata)).toEqual([null, null]);
                    expect.soft(harness.observe()).toMatchObject({
                        renderables: 2, fullRecords: 0, isDataReady: false, deskReady: false,
                        deskRows: 0, waitingCount: null, connecting: true,
                    });
                    expect.soft(harness.hook.getCurrent().coordinatorId).toBeNull();
                }
                await act(async () => {
                    if (mode === 'disconnect') harness.sync.disconnectServer();
                    gate.resolve();
                    await vi.advanceTimersByTimeAsync(0);
                    if (mode !== 'disconnect') await vi.waitFor(() => expect(harness.storage.getState().isDataReady).toBe(true));
                });
                if (mode === 'disconnect') {
                    expect(harness.observe()).toMatchObject({ isDataReady: false, deskRows: 0, waitingCount: null });
                } else {
                    const { desk, coordinatorId: selected } = harness.hook.getCurrent();
                    expect(selected).toBe(coordinatorId);
                    expect(harness.observe()).toMatchObject({ deskReady: true, waitingCount: 1, connecting: false });
                    expect(desk.list.filter(row => row.id !== selected).map(row => row.id))
                        .toEqual(mode === 'unreadable' ? [] : [harness.workerId]);
                    expect(desk.unreadable.map(row => row.id)).toEqual(mode === 'unreadable' ? [harness.workerId] : []);
                    if (mode !== 'unreadable') expect(desk.lookup.get(harness.workerId)?.metadata?.tag).toBe('ATR-101-build');
                }
                // List receipt is not followed by a second metadata fetch or a desk-only retry.
                if (mode !== 'unreadable') {
                    expect(harness.http.mock.calls.some(([path]) => /^\/v2\/sessions\/bootstrap-/.test(path))).toBe(false);
                }
                expect(harness.unexpectedPaths).toEqual([]);
                expect(firstReadyRows).toEqual(mode === 'disconnect' ? undefined : [
                    { id: harness.workerId, settled: true },
                    { id: coordinatorId, settled: true },
                ]);
            } finally {
                gate.resolve();
                unsubscribe();
            }
        },
    );

    it.each(['held', 'timely', 'disconnect'] as const)(
        'a public refresh begun before restore cannot certify unhydrated bootstrap: %s', async mode => {
            const harness = await setupBootstrap(true);
            const { Encryption } = await import('@/sync/encryption/encryption');
            const { encodeBase64 } = await import('@/encryption/base64');
            const { getActiveServerSnapshot } = await import('@/sync/domains/server/serverRuntime');
            const aes = await import('rn-encryption');
            const { plainWorkerRecord, jsonResponse } = await import('../testkit/sessionRecordHarness');
            const secret = new Uint8Array(32).fill(7);
            const writer = await Encryption.create(secret);
            const reader = await Encryption.create(secret);
            const key = new Uint8Array(32).fill(11);
            await writer.initializeSessions(new Map([[harness.workerId, key]]));
            const cipher = writer.getSessionEncryption(harness.workerId)!;
            const plain = plainWorkerRecord(harness.workerId);
            const row = { ...plain, encryptionMode: 'e2ee' as const,
                dataEncryptionKey: encodeBase64(await writer.encryptEncryptionKey(key)),
                metadata: await cipher.encryptMetadata(JSON.parse(plain.metadata)),
                agentState: await cipher.encryptAgentState(JSON.parse(plain.agentState!)),
            };
            harness.releaseList();
            await harness.start(reader);
            await act(async () => { await vi.waitFor(() => expect(harness.storage.getState().isDataReady).toBe(true)); });
            // Public disconnect retains credentials/encryption but resets readiness and
            // the queue. Public refresh is allowed before restore starts bootstrap again.
            await act(async () => { harness.sync.disconnectServer(); });
            const serverId = String(getActiveServerSnapshot().serverId);
            harness.storage.getState().applySessionOrganizationSnapshot(serverId, {
                schemaVersion: 1, version: 1, pins: [], folders: [], folderAssignments: [], tags: [], tagAssignments: [], orderEntries: [], labels: [],
            });
            const response = createDeferred<void>();
            harness.setListResponse(async () => { await response.promise; return jsonResponse({ sessions: [row], nextCursor: null, hasNext: false }); });
            harness.http.mockClear();
            const refresh = harness.sync.refreshSessions();
            await act(async () => { await vi.advanceTimersByTimeAsync(0); });
            expect(harness.http.mock.calls.filter(([path]) => new URL(path, 'http://localhost').pathname === '/v2/sessions')).toHaveLength(1);
            const gate = createDeferred<void>();
            const entered = createDeferred<void>();
            const decrypt = aes.decryptAsyncAES;
            vi.spyOn(aes, 'decryptAsyncAES').mockImplementation(async (...args) => {
                entered.resolve(); await gate.promise; return decrypt(...args);
            });
            const readyMetadata: boolean[] = [];
            const unsubscribe = harness.storage.subscribe(state => {
                if (state.isDataReady) readyMetadata.push(state.sessionListRenderables[harness.workerId]?.metadata != null);
            });
            try {
                if (mode === 'timely') gate.resolve();
                await harness.start(reader);
                await act(async () => {
                    const releasedAt = Date.now();
                    response.resolve(); await entered.promise;
                    const waitBudget = harness.sync.getSyncTuning().invalidateSyncAwaitTimeoutMs;
                    if (mode === 'timely') {
                        await vi.waitFor(() => expect(harness.storage.getState().isDataReady).toBe(true));
                        expect(Date.now() - releasedAt).toBeLessThan(waitBudget);
                    } else await vi.advanceTimersByTimeAsync(waitBudget + 1);
                });
                if (mode !== 'timely') expect.soft(harness.observe()).toMatchObject({ isDataReady: false, deskReady: false, waitingCount: null });
                await act(async () => {
                    if (mode === 'disconnect') harness.sync.disconnectServer();
                    gate.resolve(); await vi.advanceTimersByTimeAsync(0); await refresh;
                    if (mode !== 'disconnect') await vi.waitFor(() => expect(harness.storage.getState().isDataReady).toBe(true));
                });
                if (mode === 'disconnect') expect(harness.observe()).toMatchObject({ isDataReady: false, fullRecords: 0 });
                else expect(harness.observe()).toMatchObject({ isDataReady: true, deskRows: 1, waitingCount: 1 });
                expect(readyMetadata).not.toContain(false);
                // Coalesced bootstrap consumes the same fetched snapshot, including when timely.
                expect(harness.http.mock.calls.filter(([path]) => new URL(path, 'http://localhost').pathname === '/v2/sessions')).toHaveLength(1);
                expect(harness.http.mock.calls.some(([path]) => /^\/v2\/sessions\/bootstrap-/.test(path))).toBe(false);
                expect(harness.unexpectedPaths).toEqual([]);
            } finally { gate.resolve(); unsubscribe(); }
        },
    );

    it.each([
        { name: 'automatic retry after a transient failure', status: 503, direct: false },
        { name: 'explicit retry after a non-retryable failure', status: 400, direct: false },
        { name: 'direct hydrated refresh after a non-retryable failure', status: 400, direct: true },
    ])('stays unknown until $name succeeds', async ({ status, direct }) => {
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
        const refresh = status === 400
            ? harness.sync.refreshSessions(direct ? { awaitSessionListHydration: true } : undefined)
            : Promise.resolve();
        await act(async () => { await vi.advanceTimersByTimeAsync(0); });
        expect(harness.observe()).toMatchObject({ isDataReady: false, waitingCount: null, connecting: true });
        await act(async () => {
            retryResponse.resolve();
            await vi.advanceTimersByTimeAsync(0);
            await refresh;
            await vi.waitFor(() => expect(harness.storage.getState().isDataReady).toBe(true));
        });
        expect(harness.observe()).toMatchObject({ deskReady: true, waitingCount: 1, connecting: false });
        expect(harness.unexpectedPaths).toEqual([]);
    });

    it.each(['bootstrap', 'late'] as const)('recovers readiness through the %s imported-pins fetch after terminal list failure', async (timing) => {
        const harness = await setupBootstrap();
        const { jsonResponse } = await import('../testkit/sessionRecordHarness');
        const settingsResponse = createDeferred<void>();
        const recoveredList = createDeferred<void>();
        const http = harness.http.getMockImplementation()!;
        let imported = false;
        let failed = false;
        let recoveryRequested = false;
        harness.http.mockImplementation(async (path) => {
            const pathname = new URL(path, 'http://localhost').pathname;
            if (pathname === '/v2/account/settings') {
                await settingsResponse.promise;
                return jsonResponse({ content: { t: 'plain', v: { pinnedSessionKeysV1: [harness.workerId] } }, version: 1 });
            }
            if (pathname === '/v2/session-organization/import') {
                imported = true;
                return jsonResponse({ imported: { pins: 1, folders: 0, tags: 0, orderEntries: 0, labels: 0 } });
            }
            if (pathname === '/v2/session-organization' && imported) {
                return jsonResponse({ snapshot: {
                    schemaVersion: 1, version: 2,
                    pins: [{ sessionId: harness.workerId, sortKey: '00000001', pinnedAt: 1 }],
                    folders: [], folderAssignments: [], tags: [], tagAssignments: [], orderEntries: [], labels: [],
                } });
            }
            return http(path);
        });
        harness.setListResponse(async (path) => {
            if (!failed) {
                failed = true;
                return jsonResponse({ error: 'synthetic_failure' }, 400);
            }
            recoveryRequested = true;
            await recoveredList.promise;
            return harness.defaultListResponse(path);
        });
        await harness.start();
        expect(failed).toBe(true);
        await act(async () => {
            if (timing === 'late') {
                await vi.advanceTimersByTimeAsync(harness.sync.getSyncTuning().invalidateSyncAwaitTimeoutMs + 1);
            }
            settingsResponse.resolve();
            await vi.advanceTimersByTimeAsync(0);
        });
        expect(imported).toBe(true);
        expect(recoveryRequested).toBe(true);
        expect(harness.observe()).toMatchObject({ isDataReady: false, waitingCount: null, connecting: true });
        await act(async () => {
            recoveredList.resolve();
            await vi.advanceTimersByTimeAsync(0);
            await vi.waitFor(() => expect(harness.storage.getState().isDataReady).toBe(true));
        });
        expect(harness.storage.getState().sessions[harness.workerId]?.metadata?.tag).toBe('ATR-101-build');
        expect(harness.observe()).toMatchObject({ deskReady: true, waitingCount: 1, connecting: false });
        expect(harness.unexpectedPaths).toEqual([]);
    });

    it.each(['http-error', 'invalid-json'] as const)('does not certify a direct list read that fails with %s', async (failure) => {
        const harness = await setupBootstrap();
        const { jsonResponse } = await import('../testkit/sessionRecordHarness');
        harness.setListResponse(async () => jsonResponse({ error: 'synthetic_failure' }, 400));
        await harness.start();
        await act(async () => {
            await vi.advanceTimersByTimeAsync(harness.sync.getSyncTuning().invalidateSyncAwaitTimeoutMs + 1);
        });
        const failedResponse = () => failure === 'http-error'
            ? jsonResponse({ error: 'synthetic_failure' }, 400)
            : new Response('{');
        harness.setListResponse(async () => failedResponse());
        const http = harness.http.getMockImplementation()!;
        // Invalid v2 payloads try the supported v1 fallback; neither response is a list.
        harness.http.mockImplementation(async (path) => new URL(path, 'http://localhost').pathname === '/v1/sessions'
            ? failedResponse() : http(path));
        await act(async () => {
            await expect(harness.sync.refreshSessions({ awaitSessionListHydration: true })).rejects.toThrow();
        });
        expect(harness.observe()).toMatchObject({
            isDataReady: false, deskReady: false, waitingCount: null, connecting: true, renderables: 0,
        });
        expect(harness.unexpectedPaths).toEqual([]);
    });

    it('waits for required direct hydration after the snapshot and preserves its rejection', async () => {
        const harness = await setupBootstrap(true);
        const { jsonResponse, plainWorkerRecord } = await import('../testkit/sessionRecordHarness');
        harness.setListResponse(async () => jsonResponse({ error: 'synthetic_failure' }, 400));
        const recordResponse = createDeferred<void>();
        const http = harness.http.getMockImplementation()!;
        let recordRequested = false;
        let recordFails = true;
        harness.http.mockImplementation(async (path) => {
            const pathname = new URL(path, 'http://localhost').pathname;
            if (pathname === '/v2/session-organization') return jsonResponse({ snapshot: {
                schemaVersion: 1, version: 2,
                pins: [{ sessionId: harness.workerId, sortKey: '00000001', pinnedAt: 1 }],
                folders: [], folderAssignments: [], tags: [], tagAssignments: [], orderEntries: [], labels: [],
            } });
            if (pathname === `/v2/sessions/${harness.workerId}`) {
                recordRequested = true;
                await recordResponse.promise;
                return recordFails ? jsonResponse({ error: 'synthetic_failure' }, 400)
                    : jsonResponse({ session: plainWorkerRecord(harness.workerId) });
            }
            return http(path);
        });
        await harness.start();
        await act(async () => {
            await vi.advanceTimersByTimeAsync(harness.sync.getSyncTuning().invalidateSyncAwaitTimeoutMs + 1);
        });
        harness.setListResponse(harness.defaultListResponse);
        // This empty list has fetched its snapshot, but the organization-required record is still pending.
        const refresh = harness.sync.refreshSessions({ awaitSessionListHydration: true }).then(
            () => ({ status: 'resolved' as const }),
            error => ({ status: 'rejected' as const, error }),
        );
        await act(async () => { await vi.advanceTimersByTimeAsync(0); });
        expect(recordRequested).toBe(true);
        expect(harness.observe()).toMatchObject({ isDataReady: false, waitingCount: null, connecting: true });
        await act(async () => {
            recordResponse.resolve();
            expect(await refresh).toMatchObject({ status: 'rejected', error: expect.any(Error) });
        });
        expect(harness.observe()).toMatchObject({ isDataReady: false, waitingCount: null, connecting: true });
        await act(async () => {
            recordFails = false;
            await harness.sync.refreshSessions({ awaitSessionListHydration: true });
        });
        expect(harness.observe()).toMatchObject({ isDataReady: true, waitingCount: 1, connecting: false });
        expect(harness.storage.getState().sessions[harness.workerId]?.metadata?.tag).toBe('ATR-101-build');
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

    it.each([
        { order: 'old-first', direct: false },
        { order: 'new-first', direct: false },
        { order: 'old-first', direct: true },
        { order: 'new-first', direct: true },
    ] as const)('isolates a replacement server bootstrap when responses finish $order (direct refresh: $direct)', async ({ order, direct }) => {
        const harness = await setupBootstrap();
        const { upsertAndActivateServer } = await import('@/sync/domains/server/serverRuntime');
        const { jsonResponse } = await import('../testkit/sessionRecordHarness');
        let oldRefresh: Promise<void> | undefined;
        let releaseOldList = harness.releaseList;
        if (direct) {
            harness.setListResponse(async () => jsonResponse({ error: 'synthetic_failure' }, 400));
        }
        await harness.start();
        if (direct) {
            await act(async () => {
                await vi.advanceTimersByTimeAsync(harness.sync.getSyncTuning().invalidateSyncAwaitTimeoutMs + 1);
            });
            const oldList = createDeferred<void>();
            releaseOldList = () => { oldList.resolve(); };
            harness.setListResponse(async (path) => {
                await oldList.promise;
                return harness.defaultListResponse(path);
            });
            oldRefresh = harness.sync.refreshSessions({ awaitSessionListHydration: true });
            await act(async () => { await vi.advanceTimersByTimeAsync(0); });
        }
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
            await act(async () => { releaseOldList(); await vi.advanceTimersByTimeAsync(0); });
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
            await act(async () => { releaseOldList(); await vi.advanceTimersByTimeAsync(0); });
            expect(harness.observe()).toMatchObject({
                isDataReady: true, deskReady: true, waitingCount: 0, connecting: false, renderables: 0,
            });
        }
        await oldRefresh;
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
