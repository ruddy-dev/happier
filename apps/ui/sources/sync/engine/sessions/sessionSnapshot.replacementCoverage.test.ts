import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AuthCredentials } from '@/auth/storage/tokenStorage';
import type { V2SessionRecord } from '@happier-dev/protocol';

import { fetchAndApplySessions, type SessionListEncryption } from './sessionSnapshot';
import { createDeferred } from '@/dev/testkit';

/**
 * Voice announcements are a genuine side-effect boundary reached by the hydrated
 * apply path; the session-list logic under test runs unchanged beneath it.
 */
vi.mock('@/voice/context/voiceHooks', () => ({
    voiceHooks: {
        onAgentRequest: vi.fn(),
    },
}));

vi.mock('@/sync/domains/server/serverRuntime', () => ({
    getActiveServerSnapshot: () => ({
        serverId: 'test',
        serverUrl: 'https://example.test',
        kind: 'custom',
        generation: 1,
    }),
}));

function buildPlainRow(id: string): V2SessionRecord {
    return {
        id,
        seq: 1,
        createdAt: 1_700_000_000_000,
        updatedAt: 1_700_000_000_000,
        meaningfulActivityAt: 1_700_000_000_000,
        active: false,
        activeAt: 1_700_000_000_000,
        archivedAt: null,
        encryptionMode: 'plain',
        metadata: JSON.stringify({ path: '/repo', host: 'host' }),
        metadataVersion: 1,
        agentState: JSON.stringify({}),
        agentStateVersion: 1,
        lastViewedSessionSeq: 1,
        pendingPermissionRequestCount: 0,
        pendingUserActionRequestCount: 0,
        pendingBlockedCount: 0,
        dataEncryptionKey: null,
        share: null,
    };
}

function createEncryptionHarness(): SessionListEncryption {
    return {
        decryptEncryptionKeys: vi.fn(async (values: readonly string[]) => values.map(() => null)),
        initializeSessions: vi.fn(async () => {}),
        removeSessionEncryption: vi.fn(),
        getSessionEncryption: vi.fn(() => null),
    };
}

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

async function snapshotCoverage(input: Readonly<{
    page?: { hasNext?: unknown; nextCursor: string | null };
    request?: (path: string) => Promise<Response>;
    sessionListCursor?: string | null;
}>): Promise<boolean | undefined> {
    const coverage: Array<boolean | undefined> = [];
    const page = input.page ?? { hasNext: false, nextCursor: null };
    await fetchAndApplySessions({
        credentials: { token: 't', secret: 's' } as AuthCredentials,
        encryption: createEncryptionHarness(),
        sessionDataKeys: new Map<string, Uint8Array>(),
        sessionListCursor: input.sessionListCursor ?? null,
        request: input.request ?? (async () => jsonResponse({ sessions: [buildPlainRow('s1')], ...page })),
        applySessionListRenderables: (_renderables, options) => {
            coverage.push(options?.coversWholeList);
        },
        applySessions: () => {},
        repairInvalidReadStateV1: async () => {},
        log: { log: () => {} },
    });
    expect(coverage).toHaveLength(1);
    return coverage[0];
}

afterEach(() => {
    vi.clearAllMocks();
});

describe('session-list snapshot replacement coverage', () => {
    it('declares the replacement authoritative for the whole list when the server has no further page', async () => {
        await expect(snapshotCoverage({ page: { hasNext: false, nextCursor: null } })).resolves.toBe(true);
    });

    it('declares the replacement partial when the server has a further page', async () => {
        await expect(snapshotCoverage({ page: { hasNext: true, nextCursor: 'cursor_2' } })).resolves.toBe(false);
    });

    it.each([undefined, 0])('keeps coverage partial without an explicit end-of-list signal (%s)', async (hasNext) => {
        await expect(snapshotCoverage({ page: { hasNext, nextCursor: null } })).resolves.toBe(false);
    });

    it('keeps the replacement partial when the server reports a further page it cannot page to', async () => {
        await expect(snapshotCoverage({ page: { hasNext: true, nextCursor: null } })).resolves.toBe(false);
    });

    it('keeps the replacement partial when it starts from a cursor below the list head', async () => {
        await expect(snapshotCoverage({
            sessionListCursor: 'cursor_1',
            page: { hasNext: false, nextCursor: null },
        })).resolves.toBe(false);
    });

    it('keeps the replacement partial for the capped /v1/sessions fallback', async () => {
        await expect(snapshotCoverage({
            request: async (path) => path.startsWith('/v2/sessions')
                ? jsonResponse({ error: 'Not found' }, 404)
                : jsonResponse({ sessions: [buildPlainRow('s1')] }),
        })).resolves.toBe(false);
    });
});

describe('snapshot search evidence at the producer', () => {
    function snapshot(overrides: Partial<Parameters<typeof fetchAndApplySessions>[0]> = {}) {
        return fetchAndApplySessions({
            credentials: { token: 't', secret: 's' } as AuthCredentials,
            encryption: createEncryptionHarness(),
            sessionDataKeys: new Map(),
            request: async () => jsonResponse({ sessions: [], hasNext: false, nextCursor: null }),
            applySessions: () => {},
            repairInvalidReadStateV1: async () => {},
            log: { log: () => {} },
            ...overrides,
        });
    }

    it.each([
        [{ hasNext: false, nextCursor: null }, true],
        [{}, false],
        [{ hasNext: true, nextCursor: 'next' }, false],
        [{ hasNext: true, nextCursor: null }, false],
        [{ hasNext: 'false', nextCursor: null }, false],
    ])('distinguishes explicit V2 terminal evidence from stopped paging %j', async (pagination, terminal) => {
        const result = await snapshot({ request: async () => jsonResponse({ sessions: [], ...pagination }) });
        expect(result).toMatchObject({ serverReportedListEnd: terminal, cancelled: false, hasUnmaterializedRows: false });
    });

    it('does not turn the capped V1 fallback into terminal evidence or add requests', async () => {
        const request = vi.fn(async (path: string) => path.startsWith('/v2/')
            ? jsonResponse({ error: 'Not found' }, 404)
            : jsonResponse({ sessions: [buildPlainRow('legacy')] }));
        const applySessions = vi.fn();
        const result = await snapshot({ request, applySessions });
        expect(result).toMatchObject({ source: 'v1', serverReportedListEnd: false, hasUnmaterializedRows: false });
        expect(applySessions.mock.calls[0][0]).toHaveLength(1);
        expect(request.mock.calls.map(([path]) => path)).toEqual(['/v2/sessions?limit=50', '/v1/sessions']);
    });

    it.each(['missing-key', 'null-metadata', 'throw'] as const)('reports unreadable encrypted input on the full-record path: %s', async failure => {
        const row = { ...buildPlainRow('encrypted'), encryptionMode: 'e2ee' as const, metadata: 'opaque' };
        const encryption = createEncryptionHarness();
        if (failure !== 'missing-key') encryption.getSessionEncryption = () => ({
            decryptMetadata: async () => { if (failure === 'throw') throw new Error('decode failed'); return null; },
            decryptAgentState: async () => ({}),
        });
        const result = await snapshot({ encryption, request: async () => jsonResponse({ sessions: [row], hasNext: false, nextCursor: null }) });
        expect(result).toMatchObject({ serverReportedListEnd: true, hasUnmaterializedRows: true, cancelled: false });
    });

    it('reports missing plaintext metadata as incomplete while still applying the readable sibling', async () => {
        const applySessions = vi.fn();
        const result = await snapshot({ applySessions, request: async () => jsonResponse({
            sessions: [buildPlainRow('readable'), { ...buildPlainRow('unreadable'), metadata: 'invalid' }], hasNext: false, nextCursor: null,
        }) });
        expect(result.hasUnmaterializedRows).toBe(true);
        expect(applySessions.mock.calls[0][0]).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'readable', metadata: expect.any(Object) })]));
    });

    it('suppresses terminal evidence when superseded during full-record decryption, without applying stale rows', async () => {
        const decrypted = createDeferred<null>();
        const entered = createDeferred<void>();
        const encryption = createEncryptionHarness();
        encryption.getSessionEncryption = () => ({
            decryptMetadata: async () => { entered.resolve(); return decrypted.promise; },
            decryptAgentState: async () => ({}),
        });
        const applySessions = vi.fn();
        const request = async () => jsonResponse({ sessions: [{ ...buildPlainRow('encrypted'), encryptionMode: 'e2ee', metadata: 'opaque' }], hasNext: false, nextCursor: null });
        const pending = snapshot({ encryption, request, applySessions });
        await entered.promise;
        await snapshot({ encryption });
        decrypted.resolve(null);
        const result = await pending;
        expect(result).toMatchObject({ cancelled: true, serverReportedListEnd: false });
        expect(applySessions).not.toHaveBeenCalled();
    });

    it('does not certify a multi-page fetch which revisited its starting cursor before a terminal response', async () => {
        let requests = 0;
        const result = await snapshot({
            sessionListCursor: 'repeated', sessionListMaxPages: 3,
            request: async () => jsonResponse({ sessions: [], hasNext: ++requests === 1, nextCursor: requests === 1 ? 'repeated' : null }),
        });
        expect(result.serverReportedListEnd).toBe(false);
        // Evidence must not alter the existing caller's pagination cost or continuation.
        expect(requests).toBe(2);
        expect(result.hasNext).toBe(false);
    });
});
