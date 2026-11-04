import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDeferred } from '@/dev/testkit';
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

    it('does not certify an aborted replacement and its later append as an intact chain', async () => {
        const pending = createDeferred<Response>();
        harness.http.mockImplementationOnce(() => pending.promise);
        const aborted = harness.sync.fetchArchivedSessions();
        harness.http.mockImplementation(async () => jsonResponse({ sessions: [], hasNext: true, nextCursor: 'next' }));
        await harness.sync.fetchArchivedSessions();
        pending.resolve(jsonResponse({ sessions: [], hasNext: true, nextCursor: 'old' }));
        await aborted;
        expect(harness.sync.getSessionListPagingState('archived').status).toBe('unavailable');
        harness.http.mockImplementation(async () => jsonResponse({ sessions: [], hasNext: false, nextCursor: null }));
        await harness.sync.fetchMoreArchivedSessions();
        expect(harness.sync.getSessionListPagingState('archived').status).toBe('unavailable');
        await harness.sync.fetchArchivedSessions();
        expect(harness.sync.getSessionListPagingState('archived').status).toBe('exhausted');
    });
});
