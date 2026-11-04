import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDeferred, createSessionFixture } from '@/dev/testkit';
import type { SessionListEncryption } from '@/sync/engine/sessions/sessionSnapshot';
import { storage } from '@/sync/domains/state/storage';
import { installSessionRecordHarness, jsonResponse, plainWorkerRecord } from '@/ignorePrevious/testkit/sessionRecordHarness';

vi.mock('@/voice/context/voiceHooks', () => ({ voiceHooks: { onAgentRequest: vi.fn(), onSessionOnline: vi.fn(), onSessionOffline: vi.fn() } }));

describe('canonical session list paging read API', () => {
    let harness: ReturnType<typeof installSessionRecordHarness>;
    let previous: ReturnType<typeof storage.getState>;
    beforeEach(() => {
        previous = storage.getState();
        harness = installSessionRecordHarness([]);
        harness.sync.disconnectServer();
        // These pager scenarios start after bootstrap. Credentials are installed by
        // the harness; cold required hydration is covered by deskBootstrapReadiness.
        storage.setState({ isDataReady: true });
    });
    afterEach(() => {
        harness.sync.disconnectServer();
        harness.restore();
        storage.setState(previous, true);
        vi.restoreAllMocks();
    });

    it('reports not-loaded, pending, more and exhausted without revealing cursor or row identities', async () => {
        const page = createDeferred<Response>();
        harness.http.mockImplementation(async path => new URL(path, 'http://localhost').searchParams.has('cursor')
            ? jsonResponse({ sessions: [], nextCursor: null, hasNext: false }) : page.promise);
        expect(harness.sync.getSessionListPagingState('archived').status).toBe('not-loaded');
        const observed: string[] = [];
        const unsubscribe = harness.sync.subscribeSessionListPagingState(() => observed.push(harness.sync.getSessionListPagingState('archived').status));
        const first: Promise<void> = harness.sync.fetchArchivedSessions();
        expect(harness.sync.getSessionListPagingState('archived').status).toBe('loading');
        page.resolve(jsonResponse({ sessions: [], nextCursor: 'opaque-page', hasNext: true }));
        await first;
        expect(harness.sync.getSessionListPagingState('archived').status).toBe('more');
        await harness.sync.fetchMoreArchivedSessions();
        expect(harness.sync.getSessionListPagingState('archived').status).toBe('exhausted');
        expect(observed).toEqual(['loading', 'more', 'loading', 'exhausted']);
        unsubscribe();
        harness.http.mockImplementation(async () => jsonResponse({ sessions: [], nextCursor: null, hasNext: false }));
        await harness.sync.fetchArchivedSessions();
        expect(observed).toHaveLength(4);
    });

    it('retains retryable cursor on failure, and a scope reset rejects an obsolete response', async () => {
        harness.http.mockResolvedValue(jsonResponse({ sessions: [], nextCursor: 'retry-cursor', hasNext: true }));
        await harness.sync.fetchArchivedSessions();
        harness.http.mockImplementation(async () => jsonResponse({ error: 'unavailable' }, 503));
        await expect(harness.sync.fetchMoreArchivedSessions()).rejects.toThrow();
        expect(harness.sync.getSessionListPagingState('archived')).toEqual({ status: 'error', retry: 'append', hasUnmaterializedRows: false });
        const page = createDeferred<Response>();
        harness.http.mockImplementation(() => page.promise);
        const retry = harness.sync.fetchMoreArchivedSessions();
        harness.sync.disconnectServer();
        expect(harness.sync.getSessionListPagingState('archived').status).toBe('not-loaded');
        page.resolve(jsonResponse({ sessions: [], nextCursor: null, hasNext: false }));
        await retry;
        expect(harness.sync.getSessionListPagingState('archived').status).toBe('not-loaded');
    });

    it('reports repeated and longer cursor cycles as unavailable, rather than exhausted', async () => {
        let cursor = 'a';
        harness.http.mockImplementation(async () => jsonResponse({ sessions: [], nextCursor: cursor, hasNext: true }));
        await harness.sync.fetchArchivedSessions();
        cursor = 'b';
        await harness.sync.fetchMoreArchivedSessions();
        cursor = 'a';
        await harness.sync.fetchMoreArchivedSessions();
        expect(harness.sync.getSessionListPagingState('archived').status).toBe('unavailable');
        await harness.sync.fetchArchivedSessions();
        await harness.sync.fetchMoreArchivedSessions();
        expect(harness.sync.getSessionListPagingState('archived').status).toBe('unavailable');
    });

    it.each([{}, { hasNext: true, nextCursor: null }, { hasNext: 'false', nextCursor: null }])('does not infer exhaustion from unusable pagination %j', async pagination => {
        harness.http.mockImplementation(async () => jsonResponse({ sessions: [], ...pagination }));
        await harness.sync.fetchArchivedSessions();
        expect(harness.sync.getSessionListPagingState('archived').status).toBe('unavailable');
    });

    it('projects the current canonical pager through the same public API', async () => {
        const original = harness.http.getMockImplementation()!;
        harness.http.mockImplementation(async path => {
            const url = new URL(path, 'http://localhost');
            if (url.pathname === '/v2/sessions') return jsonResponse({ sessions: [], includedActive: true,
                nextCursor: url.searchParams.has('cursor') ? null : 'current-next', hasNext: !url.searchParams.has('cursor') });
            return original(path);
        });
        await harness.sync.refreshSessions({ awaitSessionListHydration: true });
        expect(harness.sync.getSessionListPagingState('current').status).toBe('more');
        await harness.sync.fetchMoreSessions();
        expect(harness.sync.getSessionListPagingState('current').status).toBe('exhausted');
    });

    it.each(['current', 'archived'] as const)('retains incomplete %s coverage across appends, and resets it on a readable replacement', async kind => {
        let unreadable = true;
        harness.http.mockImplementation(async path => {
            const append = new URL(path, 'http://localhost').searchParams.has('cursor');
            return jsonResponse({ sessions: append ? [] : [{ ...plainWorkerRecord('opaque'),
                archivedAt: kind === 'archived' ? 10 : null, metadata: unreadable ? 'invalid' : JSON.stringify({ path: '/repo', host: 'host' }),
            }], includedActive: true, hasNext: !append, nextCursor: append ? null : 'next' });
        });
        const replace = () => kind === 'current' ? harness.sync.refreshSessions({ awaitSessionListHydration: true }) : harness.sync.fetchArchivedSessions();
        const append = () => kind === 'current' ? harness.sync.fetchMoreSessions() : harness.sync.fetchMoreArchivedSessions();
        await replace();
        expect(harness.sync.getSessionListPagingState(kind)).toMatchObject({ status: 'more', hasUnmaterializedRows: true });
        await append();
        expect(harness.sync.getSessionListPagingState(kind)).toMatchObject({ status: 'unavailable', hasUnmaterializedRows: true });
        unreadable = false;
        await replace();
        await append();
        expect(harness.sync.getSessionListPagingState(kind)).toMatchObject({ status: 'exhausted', hasUnmaterializedRows: false });
    });

    it.each(['current', 'archived'] as const)('retains aggregate policy-filtered %s coverage through a terminal page, mixed append and replacement', async kind => {
        storage.setState({ settings: { ...storage.getState().settings, clientEncryptionRequirementV1: 'require_e2ee' } });
        const owner = harness.sync as unknown as { encryption: SessionListEncryption };
        vi.spyOn(owner.encryption, 'getSessionEncryption').mockReturnValue({
            decryptMetadata: async (_version, value) => JSON.parse(value), decryptAgentState: async () => ({}),
        });
        let blocked = true;
        let paged = false;
        let blockedOnTail = false;
        const original = harness.http.getMockImplementation()!;
        harness.http.mockImplementation(async path => {
            const url = new URL(path, 'http://localhost');
            if (url.pathname !== (kind === 'current' ? '/v2/sessions' : '/v2/sessions/archived')) return original(path);
            const append = url.searchParams.has('cursor');
            const rows = [
                ...(blocked && append === blockedOnTail ? [plainWorkerRecord('policy-blocked')] : []),
                ...(!append && paged ? [{ ...plainWorkerRecord('policy-searchable'), encryptionMode: 'e2ee' as const }] : []),
            ];
            return jsonResponse({ sessions: rows.map(row => ({ ...row, archivedAt: kind === 'archived' ? 10 : null })),
                includedActive: true, hasNext: paged && !append, nextCursor: paged && !append ? 'tail' : null });
        });
        const replace = () => kind === 'current' ? harness.sync.refreshSessions({ awaitSessionListHydration: true }) : harness.sync.fetchArchivedSessions();
        const append = () => kind === 'current' ? harness.sync.fetchMoreSessions() : harness.sync.fetchMoreArchivedSessions();
        await replace();
        expect(storage.getState().sessions['policy-blocked']).toBeUndefined();
        expect(storage.getState().sessionListRenderables['policy-blocked']).toBeUndefined();
        expect(harness.sync.isArchivedSessionListRowCurrent('policy-blocked', 1)).toBe(false);
        expect(harness.sync.getSessionListPagingState(kind)).toEqual({ status: 'unavailable', retry: null, hasUnmaterializedRows: true });
        paged = true;
        await replace();
        await vi.waitFor(() => expect(storage.getState().sessions['policy-searchable']?.metadata?.name).toBe('Fixing the build'));
        expect(harness.sync.getSessionListPagingState(kind)).toEqual({ status: 'more', retry: null, hasUnmaterializedRows: true });
        await append();
        expect(harness.sync.getSessionListPagingState(kind)).toEqual({ status: 'unavailable', retry: null, hasUnmaterializedRows: true });
        blockedOnTail = true;
        await replace();
        expect(harness.sync.getSessionListPagingState(kind)).toEqual({ status: 'more', retry: null, hasUnmaterializedRows: false });
        await append();
        expect(harness.sync.getSessionListPagingState(kind)).toEqual({ status: 'unavailable', retry: null, hasUnmaterializedRows: true });
        expect(storage.getState().sessions['policy-blocked']).toBeUndefined();
        expect(harness.http.mock.calls.map(([path]) => new URL(path, 'http://localhost').pathname)
            .filter(path => path.startsWith('/v2/sessions/') && !['/v2/sessions/active', '/v2/sessions/archived'].includes(path))).toEqual([]);
        blocked = false;
        await replace();
        await append();
        expect(harness.sync.getSessionListPagingState(kind)).toEqual({ status: 'exhausted', retry: null, hasUnmaterializedRows: false });
        paged = false;
        await replace();
        expect(harness.sync.getSessionListPagingState(kind)).toEqual({ status: 'exhausted', retry: null, hasUnmaterializedRows: false });
        blocked = true;
        blockedOnTail = false;
        await replace();
        expect(harness.sync.getSessionListPagingState(kind).hasUnmaterializedRows).toBe(true);
        harness.sync.disconnectServer();
        blocked = false;
        await replace();
        expect(harness.sync.getSessionListPagingState(kind)).toEqual({ status: 'exhausted', retry: null, hasUnmaterializedRows: false });
    });

    it('does not certify a disconnected chain from a late terminal page, and recovers from a fresh head', async () => {
        harness.http.mockImplementation(async () => jsonResponse({ sessions: [], hasNext: true, nextCursor: 'next' }));
        await harness.sync.fetchArchivedSessions();
        const pending = createDeferred<Response>();
        harness.http.mockImplementation(() => pending.promise);
        const append = harness.sync.fetchMoreArchivedSessions();
        harness.sync.disconnectServer();
        pending.resolve(jsonResponse({ sessions: [plainWorkerRecord('obsolete')], hasNext: false, nextCursor: null }));
        await append;
        expect(harness.sync.getSessionListPagingState('archived').status).toBe('not-loaded');
        expect(storage.getState().sessions.obsolete).toBeUndefined();
        harness.http.mockImplementation(async () => jsonResponse({ sessions: [], hasNext: false, nextCursor: null }));
        await harness.sync.fetchArchivedSessions();
        expect(harness.sync.getSessionListPagingState('archived').status).toBe('exhausted');
    });

    it.each(['current', 'archived'] as const)('compares metadata with accepted %s versions without treating unknown rows or newer exact records as stale', async kind => {
        let version = 2;
        harness.http.mockImplementation(async path => {
            const append = new URL(path, 'http://localhost').searchParams.has('cursor');
            return jsonResponse({ sessions: [{ ...plainWorkerRecord('versioned'), metadataVersion: append ? 1 : version,
                archivedAt: kind === 'archived' ? 10 : null }], includedActive: true,
            hasNext: !append, nextCursor: append ? null : 'tail' });
        });
        const replace = () => kind === 'current' ? harness.sync.refreshSessions({ awaitSessionListHydration: true }) : harness.sync.fetchArchivedSessions();
        expect(harness.sync.isSessionListMetadataVersionStale('versioned', 1)).toBe(false);
        await replace();
        expect(harness.sync.isSessionListMetadataVersionStale('unknown', 1)).toBe(false);
        expect(harness.sync.isSessionListMetadataVersionStale('versioned', 1)).toBe(true);
        expect(harness.sync.isSessionListMetadataVersionStale('versioned', 2)).toBe(false);
        expect(harness.sync.isSessionListMetadataVersionStale('versioned', 3)).toBe(false);
        if (kind === 'current') await harness.sync.fetchMoreSessions();
        else await harness.sync.fetchMoreArchivedSessions();
        expect(harness.sync.isSessionListMetadataVersionStale('versioned', 1)).toBe(true);
        // A replacement starts a new evidence chain; stale versions are not sticky.
        version = 1;
        await replace();
        expect(harness.sync.isSessionListMetadataVersionStale('versioned', 1)).toBe(false);
        harness.sync.disconnectServer();
        expect(harness.sync.isSessionListMetadataVersionStale('versioned', 0)).toBe(false);
    });

    it('requires current archive page membership and version evidence across partial pages, failure, retry and replacement', async () => {
        const cached = createSessionFixture({ id: 'cached', archivedAt: 10, metadataVersion: 1 });
        storage.getState().applySessions([cached]);
        let fail = true;
        harness.http.mockImplementation(async path => {
            const append = new URL(path, 'http://localhost').searchParams.has('cursor');
            if (append && fail) return jsonResponse({ error: 'unavailable' }, 503);
            return jsonResponse({ sessions: [{ ...plainWorkerRecord(append ? 'cached' : 'head'), archivedAt: 10, metadataVersion: 2 }],
                hasNext: !append, nextCursor: append ? null : 'tail' });
        });
        await harness.sync.fetchArchivedSessions();
        expect(harness.sync.isArchivedSessionListRowCurrent('head', 1)).toBe(false);
        expect(harness.sync.isArchivedSessionListRowCurrent('head', 2)).toBe(true);
        expect(harness.sync.isArchivedSessionListRowCurrent('head', 3)).toBe(true);
        expect(harness.sync.isArchivedSessionListRowCurrent('cached', 1)).toBe(false);
        expect(storage.getState().sessions.cached).toBeDefined();
        await expect(harness.sync.fetchMoreArchivedSessions()).rejects.toThrow();
        expect(harness.sync.isArchivedSessionListRowCurrent('head', 2)).toBe(true);
        expect(harness.sync.isArchivedSessionListRowCurrent('cached', 2)).toBe(false);
        fail = false;
        await harness.sync.fetchMoreArchivedSessions();
        expect(harness.sync.isArchivedSessionListRowCurrent('cached', 1)).toBe(false);
        expect(harness.sync.isArchivedSessionListRowCurrent('cached', 2)).toBe(true);

        const replacement = createDeferred<Response>();
        harness.http.mockImplementation(() => replacement.promise);
        const refresh = harness.sync.fetchArchivedSessions();
        expect(harness.sync.isArchivedSessionListRowCurrent('head', 2)).toBe(false);
        expect(harness.sync.isArchivedSessionListRowCurrent('cached', 2)).toBe(false);
        expect(storage.getState().sessions.cached).toBeDefined();
        replacement.resolve(jsonResponse({ sessions: [], hasNext: false, nextCursor: null }));
        await refresh;
        expect(harness.sync.getSessionListPagingState('archived').status).toBe('exhausted');
        expect(harness.sync.isArchivedSessionListRowCurrent('cached', 2)).toBe(false);
        expect(storage.getState().sessions.cached).toBeDefined();
    });

    it.each(['replace', 'scope'] as const)('does not authorize archive membership from an obsolete page after %s', async cancellation => {
        harness.http.mockResolvedValue(jsonResponse({ sessions: [{ ...plainWorkerRecord('accepted'), archivedAt: 10 }], hasNext: true, nextCursor: 'tail' }));
        await harness.sync.fetchArchivedSessions();
        const obsolete = createDeferred<Response>();
        harness.http.mockImplementation(() => obsolete.promise);
        const append = harness.sync.fetchMoreArchivedSessions();
        if (cancellation === 'scope') harness.sync.disconnectServer();
        else {
            harness.http.mockImplementation(async () => jsonResponse({ sessions: [], hasNext: false, nextCursor: null }));
            await harness.sync.fetchArchivedSessions();
        }
        obsolete.resolve(jsonResponse({ sessions: [{ ...plainWorkerRecord('obsolete-member'), archivedAt: 10 }], hasNext: false, nextCursor: null }));
        await append;
        expect(harness.sync.isArchivedSessionListRowCurrent('accepted', 1)).toBe(false);
        expect(harness.sync.isArchivedSessionListRowCurrent('obsolete-member', 1)).toBe(false);
        expect(storage.getState().sessions['obsolete-member']).toBeUndefined();
    });

    describe('owned background metadata hydration', () => {
        it('reconciles a hydrated head when its store publication starts the next page before completion notification', async () => {
            const pending = deferMetadata();
            const original = harness.http.getMockImplementation()!;
            harness.http.mockImplementation(async path => {
                const url = new URL(path, 'http://localhost');
                if (url.pathname !== '/v2/sessions') return original(path);
                const append = url.searchParams.has('cursor');
                return jsonResponse({ sessions: append ? [] : [encryptedRow()], includedActive: true,
                    hasNext: !append, nextCursor: append ? null : 'tail' });
            });
            await harness.sync.refreshSessions({ awaitSessionListHydration: true });
            await pending.entered.promise;
            let tail: Promise<void> | undefined;
            const unsubscribe = storage.subscribe(state => {
                if (!tail && state.sessions['pending-metadata']?.metadata?.name === 'Hydrated head') {
                    tail = harness.sync.fetchMoreSessions();
                }
            });
            try {
                pending.metadata.resolve({ path: '/repo', host: 'host', name: 'Hydrated head' });
                await vi.waitFor(() => expect(tail).toBeDefined());
                await tail;
                expect(storage.getState().sessionListRenderables['pending-metadata']?.metadata?.name).toBe('Hydrated head');
                expect(harness.sync.getSessionListPagingState('current')).toEqual({ status: 'exhausted', retry: null, hasUnmaterializedRows: false });
                expect(pending.decrypt).toHaveBeenCalledTimes(1);
                expect(harness.http.mock.calls.filter(([path]) => new URL(path, 'http://localhost').pathname === '/v2/sessions')).toHaveLength(2);
            } finally { unsubscribe(); }
        });

        it.each([
            ['head-first', false], ['tail-first', false], ['head-first', true], ['tail-first', true],
        ] as const)('keeps accepted page hydration alive across append: %s, newer version on tail=%s', async (order, sameRow) => {
            const headMetadata = createDeferred<{ path: string; host: string; name: string }>();
            const tailMetadata = createDeferred<{ path: string; host: string; name: string }>();
            const entered = [createDeferred<void>(), createDeferred<void>()];
            const decrypt = vi.fn((_version: number, value: string) => {
                const page = value === 'head-ciphertext' ? 0 : 1;
                entered[page].resolve();
                return page === 0 ? headMetadata.promise : tailMetadata.promise;
            });
            const owner = harness.sync as unknown as { encryption: SessionListEncryption };
            vi.spyOn(owner.encryption, 'getSessionEncryption').mockReturnValue({ decryptMetadata: decrypt, decryptAgentState: async () => ({}) });
            const original = harness.http.getMockImplementation()!;
            harness.http.mockImplementation(async path => {
                const url = new URL(path, 'http://localhost');
                if (url.pathname !== '/v2/sessions') return original(path);
                const append = url.searchParams.has('cursor');
                return jsonResponse({ sessions: [{ ...plainWorkerRecord(append && !sameRow ? 'tail' : 'head'), encryptionMode: 'e2ee',
                    metadata: append ? 'tail-ciphertext' : 'head-ciphertext', agentState: null, metadataVersion: append ? 3 : 2 }],
                includedActive: true, hasNext: !append, nextCursor: append ? null : 'tail' });
            });
            await harness.sync.refreshSessions({ awaitSessionListHydration: true });
            await entered[0].promise;
            await harness.sync.fetchMoreSessions();
            await entered[1].promise;
            expect(harness.sync.getSessionListPagingState('current')).toMatchObject({ status: 'unavailable', hasUnmaterializedRows: true });
            const settleHead = async () => {
                headMetadata.resolve({ path: '/repo', host: 'host', name: 'Head' });
                if (!sameRow) await expect.poll(() => storage.getState().sessionListRenderables.head.metadata?.name).toBe('Head');
                else await new Promise(resolve => setTimeout(resolve, 100));
            };
            const settleTail = async () => {
                tailMetadata.resolve({ path: '/repo', host: 'host', name: 'Tail' });
                await expect.poll(() => storage.getState().sessionListRenderables[sameRow ? 'head' : 'tail'].metadata?.name).toBe('Tail');
            };
            if (order === 'head-first') {
                await settleHead();
                expect(harness.sync.getSessionListPagingState('current').status).toBe('unavailable');
                await settleTail();
            } else { await settleTail(); await settleHead(); }
            await expect.poll(() => harness.sync.getSessionListPagingState('current')).toEqual({ status: 'exhausted', retry: null, hasUnmaterializedRows: false });
            expect(storage.getState().sessionListRenderables[sameRow ? 'head' : 'tail'].metadataVersion).toBe(3);
            expect(storage.getState().sessions[sameRow ? 'head' : 'tail']?.metadata?.name).toBe('Tail');
            expect(decrypt).toHaveBeenCalledTimes(2);
            expect(harness.http.mock.calls.filter(([path]) => new URL(path, 'http://localhost').pathname.startsWith('/v2/sessions'))).toHaveLength(2);
        });

        it.each(['loading', 'error'] as const)('hydrates the accepted head while append is %s without overwriting its lifecycle', async phase => {
            const pending = deferMetadata();
            const page = createDeferred<Response>();
            const pageEntered = createDeferred<void>();
            const original = harness.http.getMockImplementation()!;
            harness.http.mockImplementation(async path => {
                const url = new URL(path, 'http://localhost');
                if (url.pathname !== '/v2/sessions') return original(path);
                if (url.searchParams.has('cursor')) { pageEntered.resolve(); return page.promise; }
                return jsonResponse({ sessions: [encryptedRow()], includedActive: true, hasNext: true, nextCursor: 'tail' });
            });
            await harness.sync.refreshSessions({ awaitSessionListHydration: true });
            await pending.entered.promise;
            const append = harness.sync.fetchMoreSessions().catch(error => error);
            await pageEntered.promise;
            if (phase === 'error') {
                page.resolve(jsonResponse({ error: 'failed' }, 503));
                expect(await append).toBeInstanceOf(Error);
            }
            pending.metadata.resolve({ path: '/repo', host: 'host', name: 'Retained head' });
            await expect.poll(() => storage.getState().sessionListRenderables['pending-metadata']?.metadata?.name).toBe('Retained head');
            expect(harness.sync.getSessionListPagingState('current')).toMatchObject({ status: phase, retry: phase === 'error' ? 'append' : null });
            if (phase === 'loading') {
                page.resolve(jsonResponse({ error: 'failed' }, 503));
                expect(await append).toBeInstanceOf(Error);
            }
            expect(harness.sync.getSessionListPagingState('current')).toMatchObject({ status: 'error', retry: 'append' });
            harness.http.mockImplementation(async () => jsonResponse({ sessions: [], includedActive: true, hasNext: false, nextCursor: null }));
            await harness.sync.fetchMoreSessions();
            expect(harness.sync.getSessionListPagingState('current')).toMatchObject({ status: 'exhausted', hasUnmaterializedRows: false });
        });

        function deferMetadata() {
            const metadata = createDeferred<{ path: string; host: string; name: string } | null>();
            const entered = createDeferred<void>();
            const owner = harness.sync as unknown as { encryption: SessionListEncryption };
            const decrypt = vi.fn(() => { entered.resolve(); return metadata.promise; });
            vi.spyOn(owner.encryption, 'getSessionEncryption').mockReturnValue({
                decryptMetadata: decrypt, decryptAgentState: async () => ({}),
            });
            return { metadata, entered, decrypt };
        }
        const encryptedRow = () => ({ ...plainWorkerRecord('pending-metadata'), encryptionMode: 'e2ee' as const,
            metadata: 'opaque-metadata', agentState: null, metadataVersion: 2 });

        it('does not erase policy-filtered coverage when allowed head metadata hydrates after terminal append', async () => {
            storage.setState({ settings: { ...storage.getState().settings, clientEncryptionRequirementV1: 'require_e2ee' } });
            const pending = deferMetadata();
            const original = harness.http.getMockImplementation()!;
            harness.http.mockImplementation(async path => {
                const url = new URL(path, 'http://localhost');
                if (url.pathname !== '/v2/sessions') return original(path);
                const append = url.searchParams.has('cursor');
                return jsonResponse({ sessions: append ? [] : [plainWorkerRecord('policy-blocked'), encryptedRow()],
                    includedActive: true, hasNext: !append, nextCursor: append ? null : 'tail' });
            });
            await harness.sync.refreshSessions({ awaitSessionListHydration: true });
            await pending.entered.promise;
            await harness.sync.fetchMoreSessions();
            expect(harness.sync.getSessionListPagingState('current')).toEqual({ status: 'unavailable', retry: null, hasUnmaterializedRows: true });
            pending.metadata.resolve({ path: '/repo', host: 'host', name: 'Allowed head' });
            await expect.poll(() => storage.getState().sessionListRenderables['pending-metadata']?.metadata?.name).toBe('Allowed head');
            expect(harness.sync.getSessionListPagingState('current')).toEqual({ status: 'unavailable', retry: null, hasUnmaterializedRows: true });
            expect(storage.getState().sessions['policy-blocked']).toBeUndefined();
            expect(storage.getState().sessionListRenderables['policy-blocked']).toBeUndefined();
        });

        it.each([false, true])('recomputes terminal coverage after actual decrypt, preserving earlier unreadable=%s', async earlierUnreadable => {
            const pending = deferMetadata();
            const original = harness.http.getMockImplementation()!;
            harness.http.mockImplementation(async path => {
                const url = new URL(path, 'http://localhost');
                if (url.pathname !== '/v2/sessions') return original(path);
                const append = url.searchParams.has('cursor');
                return jsonResponse({ sessions: append ? [encryptedRow()] : [{ ...plainWorkerRecord('earlier'),
                    metadata: earlierUnreadable ? 'invalid' : JSON.stringify({ path: '/repo', host: 'host', name: 'Earlier' }),
                }], includedActive: true, hasNext: !append, nextCursor: append ? null : 'tail' });
            });
            await harness.sync.refreshSessions({ awaitSessionListHydration: true });
            const tail = harness.sync.fetchMoreSessions();
            await pending.entered.promise;
            await tail;
            expect(harness.sync.getSessionListPagingState('current')).toMatchObject({ status: 'unavailable', hasUnmaterializedRows: true });
            pending.metadata.resolve({ path: '/repo', host: 'host', name: 'Hydrated' });
            await expect.poll(() => storage.getState().sessionListRenderables['pending-metadata']?.metadata?.name).toBe('Hydrated');
            await expect.poll(() => harness.sync.getSessionListPagingState('current')).toEqual({
                status: earlierUnreadable ? 'unavailable' : 'exhausted', retry: null, hasUnmaterializedRows: earlierUnreadable,
            });
            expect(pending.decrypt).toHaveBeenCalledTimes(1);
            expect(harness.http.mock.calls.filter(([path]) => new URL(path, 'http://localhost').pathname === '/v2/sessions')).toHaveLength(2);
        });

        it.each(['replace', 'scope'] as const)('ignores hydration completing after %s', async obsolete => {
            const pending = deferMetadata();
            const original = harness.http.getMockImplementation()!;
            let rows = [encryptedRow()];
            harness.http.mockImplementation(async path => new URL(path, 'http://localhost').pathname === '/v2/sessions'
                ? jsonResponse({ sessions: rows, includedActive: true, hasNext: false, nextCursor: null }) : original(path));
            await harness.sync.refreshSessions({ awaitSessionListHydration: true });
            await pending.entered.promise;
            if (obsolete === 'scope') harness.sync.disconnectServer();
            else {
                rows = [];
                await harness.sync.refreshSessions({ awaitSessionListHydration: true });
            }
            const state = harness.sync.getSessionListPagingState('current');
            pending.metadata.resolve({ path: '/repo', host: 'host', name: 'Obsolete' });
            // Cross the producer's final batch flush without issuing another request.
            await new Promise(resolve => setTimeout(resolve, 100));
            expect(harness.sync.getSessionListPagingState('current')).toBe(state);
            expect(storage.getState().sessions['pending-metadata']).toBeUndefined();
        });

        it.each([false, true])('hydrates an accepted ordinary-list head after terminal append with older cache=%s, without refresh', async olderCache => {
            const pending = deferMetadata();
            if (olderCache) storage.getState().applySessions([createSessionFixture({
                id: 'pending-metadata', metadataVersion: 1, metadata: { path: '/repo', host: 'host', name: 'Older' },
            })]);
            const original = harness.http.getMockImplementation()!;
            harness.http.mockImplementation(async path => {
                const url = new URL(path, 'http://localhost');
                if (url.pathname !== '/v2/sessions') return original(path);
                const append = url.searchParams.has('cursor');
                return jsonResponse({ sessions: append ? [] : [encryptedRow()], includedActive: true,
                    hasNext: !append, nextCursor: append ? null : 'tail' });
            });
            // Ordinary SessionsList uses the non-awaiting snapshot caller and fetchMoreSessions.
            const owner = harness.sync as unknown as { fetchSessions: () => Promise<void> };
            await owner.fetchSessions();
            await pending.entered.promise;
            await harness.sync.fetchMoreSessions();
            pending.metadata.resolve({ path: '/repo', host: 'host', name: 'Recovered head' });
            await expect.poll(() => storage.getState().sessionListRenderables['pending-metadata']?.metadata?.name).toBe('Recovered head');
            expect(storage.getState().sessions['pending-metadata']?.metadataVersion).toBe(2);
            await expect.poll(() => harness.sync.getSessionListPagingState('current')).toEqual({ status: 'exhausted', retry: null, hasUnmaterializedRows: false });
            expect(pending.decrypt).toHaveBeenCalledTimes(1);
            expect(harness.http.mock.calls.filter(([path]) => new URL(path, 'http://localhost').pathname === '/v2/sessions')).toHaveLength(2);
        });

        it('keeps older readable metadata partial when current hydration fails, then recovers through the canonical reload', async () => {
            const original = harness.http.getMockImplementation()!;
            let row = plainWorkerRecord('pending-metadata');
            harness.http.mockImplementation(async path => new URL(path, 'http://localhost').pathname === '/v2/sessions'
                ? jsonResponse({ sessions: [row], includedActive: true, hasNext: false, nextCursor: null }) : original(path));
            await harness.sync.refreshSessions({ awaitSessionListHydration: true });
            row = encryptedRow();
            const pending = deferMetadata();
            await harness.sync.refreshSessions({ awaitSessionListHydration: true });
            await pending.entered.promise;
            expect(storage.getState().sessionListRenderables[row.id].metadataVersion).toBe(1);
            pending.metadata.resolve(null);
            await expect.poll(() => storage.getState().sessions[row.id]?.metadataVersion).toBe(2);
            // The snapshot preserves the older readable label, but it cannot prove coverage.
            expect(storage.getState().sessionListRenderables[row.id].metadataVersion).toBe(1);
            expect(harness.sync.getSessionListPagingState('current')).toMatchObject({ status: 'unavailable', hasUnmaterializedRows: true });
            row = { ...plainWorkerRecord(row.id), metadataVersion: 2 };
            await harness.sync.refreshSessions({ awaitSessionListHydration: true });
            expect(harness.sync.getSessionListPagingState('current')).toMatchObject({ status: 'exhausted', hasUnmaterializedRows: false });
        });

        it.each(['fallback', 'cycle'] as const)('does not certify %s coverage when metadata becomes readable', async invalid => {
            const pending = deferMetadata();
            const original = harness.http.getMockImplementation()!;
            harness.http.mockImplementation(async path => {
                const url = new URL(path, 'http://localhost');
                if (invalid === 'fallback' && url.pathname === '/v2/sessions') return jsonResponse({}, 404);
                if (url.pathname === '/v1/sessions') return jsonResponse({ sessions: [encryptedRow()] });
                if (url.pathname !== '/v2/sessions') return original(path);
                return jsonResponse({ sessions: url.searchParams.has('cursor') ? [encryptedRow()] : [],
                    includedActive: true, hasNext: true, nextCursor: 'cycle' });
            });
            await harness.sync.refreshSessions({ awaitSessionListHydration: true });
            if (invalid === 'cycle') await harness.sync.fetchMoreSessions();
            await pending.entered.promise;
            pending.metadata.resolve({ path: '/repo', host: 'host', name: 'Readable' });
            await expect.poll(() => storage.getState().sessionListRenderables['pending-metadata']?.metadata?.name).toBe('Readable');
            await expect.poll(() => harness.sync.getSessionListPagingState('current').hasUnmaterializedRows).toBe(false);
            expect(harness.sync.getSessionListPagingState('current').status).toBe('unavailable');
        });
    });

    it('shares ordinary current requests only while they still own the pager', async () => {
        const owner = harness.sync as unknown as { fetchSessions: () => Promise<void> };
        const original = harness.http.getMockImplementation()!;
        const stalePage = createDeferred<Response>();
        const entered = createDeferred<void>();
        let respond = () => { entered.resolve(); return stalePage.promise; };
        harness.http.mockImplementation(path => new URL(path, 'http://localhost').pathname === '/v2/session-organization'
            ? original(path) : respond());
        const first = owner.fetchSessions();
        await entered.promise;
        const shared = owner.fetchSessions();
        respond = async () => jsonResponse({ sessions: [], includedActive: true, hasNext: true, nextCursor: 'new-page' });
        await harness.sync.refreshSessions({ awaitSessionListHydration: true });
        respond = async () => jsonResponse({ sessions: [], includedActive: true, hasNext: false, nextCursor: null });
        // Must issue a fresh head, rather than joining the obsolete ordinary request.
        await owner.fetchSessions();
        stalePage.resolve(jsonResponse({ sessions: [], includedActive: true, hasNext: true, nextCursor: 'obsolete-page' }));
        await Promise.all([first, shared]);
        expect(harness.sync.getSessionListPagingState('current').status).toBe('exhausted');
        expect(harness.http.mock.calls.filter(([path]) => new URL(path, 'http://localhost').pathname === '/v2/sessions')).toHaveLength(3);
    });

    describe.each(['current', 'archived'] as const)('%s request ownership', kind => {
        const replace = (harness: ReturnType<typeof installSessionRecordHarness>) => kind === 'current'
            ? harness.sync.refreshSessions({ awaitSessionListHydration: true }) : harness.sync.fetchArchivedSessions();
        const append = (harness: ReturnType<typeof installSessionRecordHarness>) => kind === 'current'
            ? harness.sync.fetchMoreSessions() : harness.sync.fetchMoreArchivedSessions();

        it('does not append the previous cursor while a replacement head is pending', async () => {
            const original = harness.http.getMockImplementation()!;
            let respond: () => Promise<Response> = async () => jsonResponse({ sessions: [], includedActive: true, hasNext: true, nextCursor: 'old-page' });
            harness.http.mockImplementation(path => new URL(path, 'http://localhost').pathname === '/v2/session-organization'
                ? original(path) : respond());
            await replace(harness);
            const head = createDeferred<Response>();
            const entered = createDeferred<void>();
            respond = () => { entered.resolve(); return head.promise.then(response => response.clone()); };
            const replacement = replace(harness);
            await entered.promise;
            const callsBeforeAppend = harness.http.mock.calls.length;
            const prematureAppend = append(harness);
            head.resolve(jsonResponse({ sessions: [], includedActive: true, hasNext: true, nextCursor: 'new-page' }));
            await Promise.all([replacement, prematureAppend]);
            expect(harness.http.mock.calls).toHaveLength(callsBeforeAppend);
            expect(harness.sync.getSessionListPagingState(kind).status).toBe('more');
            const cursors: Array<string | null> = [];
            harness.http.mockImplementation(async path => {
                cursors.push(new URL(path, 'http://localhost').searchParams.get('cursor'));
                return jsonResponse({ sessions: [], includedActive: true, hasNext: false, nextCursor: null });
            });
            await append(harness);
            expect(cursors).toEqual(['new-page']);
            expect(harness.sync.getSessionListPagingState(kind).status).toBe('exhausted');
        });

        it('pages the replacement chain while an obsolete append is still pending', async () => {
            const original = harness.http.getMockImplementation()!;
            let respond: (path: string) => Promise<Response> = async () => jsonResponse({ sessions: [], includedActive: true, hasNext: true, nextCursor: 'old-page' });
            harness.http.mockImplementation(path => new URL(path, 'http://localhost').pathname === '/v2/session-organization'
                ? original(path) : respond(path));
            await replace(harness);
            const stalePage = createDeferred<Response>();
            const entered = createDeferred<void>();
            respond = () => { entered.resolve(); return stalePage.promise; };
            const stale = append(harness);
            await entered.promise;
            respond = async () => jsonResponse({ sessions: [], includedActive: true, hasNext: true, nextCursor: 'new-page' });
            await replace(harness);
            const cursors: Array<string | null> = [];
            respond = async path => {
                cursors.push(new URL(path, 'http://localhost').searchParams.get('cursor'));
                return jsonResponse({ sessions: [], includedActive: true, hasNext: false, nextCursor: null });
            };
            await append(harness);
            expect(cursors).toEqual(['new-page']);
            stalePage.resolve(jsonResponse({ sessions: [], includedActive: true, hasNext: false, nextCursor: null }));
            await stale;
            expect(harness.sync.getSessionListPagingState(kind).status).toBe('exhausted');
        });

        it.each([
            ['replace', 'terminal', 'older-first'], ['replace', 'terminal', 'newer-first'],
            ['replace', 'error', 'older-first'], ['replace', 'error', 'newer-first'],
            ['append', 'terminal', 'older-first'], ['append', 'terminal', 'newer-first'],
            ['append', 'error', 'older-first'], ['append', 'error', 'newer-first'],
        ] as const)('preserves the new chain after stale %s %s, %s', async (operation, outcome, order) => {
            const original = harness.http.getMockImplementation()!;
            let respond: (path: string) => Promise<Response> = async () => jsonResponse({ sessions: [], includedActive: true, hasNext: true, nextCursor: 'old-page' });
            harness.http.mockImplementation(path => new URL(path, 'http://localhost').pathname === '/v2/session-organization'
                ? original(path) : respond(path));
            await replace(harness);
            const oldPage = createDeferred<Response>();
            const oldEntered = createDeferred<void>();
            respond = () => { oldEntered.resolve(); return oldPage.promise; };
            // Attach the rejection handler immediately so the error ordering is itself observed.
            const oldRequest = (operation === 'append' ? append(harness) : replace(harness))
                .then(() => null, error => error);
            await oldEntered.promise;
            const newPage = createDeferred<Response>();
            const newEntered = createDeferred<void>();
            respond = () => { newEntered.resolve(); return newPage.promise; };
            const newRequest = replace(harness);
            await newEntered.promise;
            const settleOld = async () => {
                oldPage.resolve(outcome === 'error' ? jsonResponse({ error: 'failed' }, 503)
                    : jsonResponse({ sessions: [plainWorkerRecord('obsolete')], includedActive: true, hasNext: false, nextCursor: null }));
                const error = await oldRequest;
                if (outcome === 'error') expect(error).toBeInstanceOf(Error);
                else expect(error).toBeNull();
            };
            const settleNew = async () => {
                newPage.resolve(jsonResponse({ sessions: [], includedActive: true, hasNext: true, nextCursor: 'new-page' }));
                await newRequest;
            };
            if (order === 'older-first') {
                await settleOld();
                expect(harness.sync.getSessionListPagingState(kind).status).toBe('loading');
                await settleNew();
            } else {
                await settleNew();
                await settleOld();
            }
            expect(harness.sync.getSessionListPagingState(kind)).toEqual({ status: 'more', retry: null, hasUnmaterializedRows: false });
            expect(storage.getState().sessions.obsolete).toBeUndefined();
            const cursors: Array<string | null> = [];
            respond = async path => {
                cursors.push(new URL(path, 'http://localhost').searchParams.get('cursor'));
                return jsonResponse({ sessions: [], includedActive: true, hasNext: false, nextCursor: null });
            };
            await append(harness);
            expect(cursors).toEqual(['new-page']);
            expect(harness.sync.getSessionListPagingState(kind).status).toBe('exhausted');
        });
    });
});
