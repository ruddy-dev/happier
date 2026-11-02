import { vi } from 'vitest';
import type { V2SessionRecord } from '@happier-dev/protocol';
import { apiSocket } from '@/sync/api/session/apiSocket';
import { storage } from '@/sync/domains/state/storage';
import { upsertAndActivateServer, getActiveServerSnapshot } from '@/sync/domains/server/serverRuntime';
import { sync } from '@/sync/sync';

export function plainWorkerRecord(id: string): V2SessionRecord {
    const now = Date.now();
    return {
        id, seq: 1, createdAt: now, updatedAt: now, meaningfulActivityAt: now,
        active: true, activeAt: now, archivedAt: null, encryptionMode: 'plain',
        metadata: JSON.stringify({ v: 1, flavor: 'claude', name: 'Fixing the build', path: '/tmp/desk-worker', tag: 'ATR-101-build' }),
        metadataVersion: 1,
        agentState: JSON.stringify({ requests: { 'cold-request': { tool: 'Bash', arguments: { command: 'yarn db:migrate' }, createdAt: now } } }),
        agentStateVersion: 1, lastViewedSessionSeq: 0,
        pendingPermissionRequestCount: 1, pendingUserActionRequestCount: 0, pendingRequestObservedAt: now,
        pendingBlockedCount: 0, pendingCount: 0, pendingVersion: 0,
        runtimeActivityState: 'unknown', runtimeActivityActiveCount: 0, runtimeActivityObservedAt: null, runtimeActivityRevision: 0,
        dataEncryptionKey: null, share: null,
    };
}

export function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** Only HTTP and plain-session crypto are faked. The sync singleton, snapshot/exact
 * orchestration, normalization, store and desk hooks all execute their real paths. */
export function installSessionRecordHarness(rows: V2SessionRecord[]) {
    upsertAndActivateServer({ serverUrl: 'http://localhost:53288', scope: 'tab' });
    const testSync = sync as unknown as { credentials: unknown; encryption: unknown; hasFetchedSessionsSnapshotForActiveServer: boolean };
    const previousSnapshotFetched = testSync.hasFetchedSessionsSnapshotForActiveServer;
    testSync.hasFetchedSessionsSnapshotForActiveServer = false;
    const previousCredentials = testSync.credentials;
    const previousEncryption = testSync.encryption;
    testSync.credentials = { token: 'test-token', secret: '' };
    testSync.encryption = {
        decryptEncryptionKey: async () => { throw new Error('Plain record requested encryption keys'); },
        decryptEncryptionKeys: async () => { throw new Error('Plain snapshot requested encryption keys'); },
        initializeSessions: async () => { throw new Error('Plain snapshot initialized encryption'); },
        removeSessionEncryption: () => {},
        getSessionEncryption: () => null,
    };
    const serverId = String(getActiveServerSnapshot().serverId);
    // Avoid an unrelated organization HTTP round trip; this is an existing empty snapshot.
    storage.setState({ sessionOrganizationSnapshotVersionByServerId: { [serverId]: 1 } });
    const http = vi.fn(async (path: string): Promise<Response> => {
        const url = new URL(path, 'http://localhost');
        if (url.pathname === '/health' || url.pathname === '/v1/auth/ping') return jsonResponse({ ok: true });
        if (url.pathname === '/v2/sessions' || url.pathname === '/v2/sessions/active') {
            return jsonResponse({ sessions: rows, nextCursor: null, hasNext: false });
        }
        if (/^\/v2\/sessions\/[^/]+$/.test(url.pathname)) {
            const row = rows.find(row => row.id === decodeURIComponent(url.pathname.split('/').at(-1)!));
            return row ? jsonResponse({ session: row }) : jsonResponse({ error: 'not_found' }, 404);
        }
        if (url.pathname === '/v2/session-organization') return jsonResponse({ snapshot: {
            schemaVersion: 1, version: 1, pins: [], folders: [], folderAssignments: [], tags: [], tagAssignments: [], orderEntries: [], labels: [],
        } });
        throw new Error(`Unexpected HTTP boundary: ${url.pathname}`);
    });
    const request = vi.spyOn(apiSocket, 'request').mockImplementation((path) => http(path));
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => http(input instanceof Request ? input.url : String(input))));
    return {
        http,
        sync,
        restore: () => {
            testSync.hasFetchedSessionsSnapshotForActiveServer = previousSnapshotFetched;
            testSync.credentials = previousCredentials;
            testSync.encryption = previousEncryption;
            request.mockRestore();
            vi.unstubAllGlobals();
        },
    };
}
