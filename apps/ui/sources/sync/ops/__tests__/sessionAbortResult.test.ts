import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RPC_ERROR_CODES } from '@happier-dev/protocol/rpc';
import { RpcError } from '@happier-dev/protocol/rpcErrors';
import { createSessionFixture } from '@/dev/testkit/fixtures/sessionFixtures';

vi.mock('../../sync', async () => {
    const { installSyncStub } = await import('@/dev/testkit/mocks/sync');
    return installSyncStub()();
});

import { apiSocket } from '@/sync/api/session/apiSocket';
import { TokenStorage } from '@/auth/storage/tokenStorage';
import { storage } from '@/sync/domains/state/storage';
import { sessionAbort, sessionAbortResult } from '../sessions';

const initialStorageState = storage.getState();
const sessionId = 'abort-result-session';

function thinkingMarkers() {
    const session = storage.getState().sessions[sessionId];
    return {
        thinking: session?.thinking,
        optimisticThinkingAt: session?.optimisticThinkingAt,
        thinkingGraceUntil: session?.thinkingGraceUntil,
    };
}

describe('sessionAbortResult', () => {
    beforeEach(() => {
        storage.setState(initialStorageState, true);
        storage.getState().applySessions([createSessionFixture({ id: sessionId, active: true, thinking: true })]);
        storage.getState().markSessionOptimisticThinking(sessionId);
        vi.spyOn(apiSocket, 'sessionRPC').mockResolvedValue(undefined);
        // Credential storage is the external boundary reached by scoped RPC retry.
        // It must not read the developer's credentials in these tests.
        vi.spyOn(TokenStorage, 'getCredentialsForServerUrl').mockRejectedValue(
            new RpcError('No listener', RPC_ERROR_CODES.METHOD_NOT_AVAILABLE),
        );
    });

    afterEach(() => {
        vi.restoreAllMocks();
        storage.setState(initialStorageState, true);
    });

    it('reports successful dispatch and clears local thinking markers', async () => {
        expect(thinkingMarkers().thinking).toBe(true);
        expect(thinkingMarkers().optimisticThinkingAt).toEqual(expect.any(Number));
        await expect(sessionAbortResult(sessionId)).resolves.toEqual({ ok: true });
        expect(thinkingMarkers()).toEqual({
            thinking: false,
            optimisticThinkingAt: null,
            thinkingGraceUntil: expect.any(Number),
        });
    });

    it.each([
        [{ error: 'Method not found', errorCode: RPC_ERROR_CODES.METHOD_NOT_FOUND }, { ok: false, reason: 'not_listening' }],
        [{ error: 'Abort denied', errorCode: RPC_ERROR_CODES.FORBIDDEN }, { ok: false, reason: 'rejected', error: 'Abort denied' }],
    ])('reports a resolved RPC error %j without changing thinking markers', async (reply, expected) => {
        const before = thinkingMarkers();
        vi.mocked(apiSocket.sessionRPC).mockResolvedValue(reply);
        await expect(sessionAbortResult(sessionId)).resolves.toEqual(expected);
        expect(thinkingMarkers()).toEqual(before);
    });

    it.each([
        [RPC_ERROR_CODES.METHOD_NOT_AVAILABLE, 'not_listening'],
        ['scoped_session_encryption_unavailable', 'encryption_unavailable'],
        ['session_encryption_not_found', 'encryption_unavailable'],
    ])('reports %s without changing thinking markers', async (errorCode, reason) => {
        const before = thinkingMarkers();
        vi.mocked(apiSocket.sessionRPC).mockRejectedValue(new RpcError('Abort unavailable', errorCode));
        await expect(sessionAbortResult(sessionId)).resolves.toEqual({ ok: false, reason });
        expect(thinkingMarkers()).toEqual(before);
    });

    it.each(['RPC method not available', 'Session encryption not found', 'Network disconnected'])(
        'rethrows unclassified failure %s without changing thinking markers', async (message) => {
            const error = new Error(message);
            const before = thinkingMarkers();
            vi.mocked(apiSocket.sessionRPC).mockRejectedValue(error);
            vi.mocked(TokenStorage.getCredentialsForServerUrl).mockRejectedValue(error);
            await expect(sessionAbortResult(sessionId)).rejects.toBe(error);
            expect(thinkingMarkers()).toEqual(before);
        },
    );

    it('keeps legacy abort a no-op when no listener is available', async () => {
        const before = thinkingMarkers();
        vi.mocked(apiSocket.sessionRPC).mockRejectedValue(new RpcError('No listener', RPC_ERROR_CODES.METHOD_NOT_AVAILABLE));
        await expect(sessionAbort(sessionId)).resolves.toBeUndefined();
        expect(thinkingMarkers()).toEqual(before);
    });

    it.each(['scoped_session_encryption_unavailable', 'session_encryption_not_found'])(
        'keeps legacy recovery for %s', async (errorCode) => {
            vi.mocked(apiSocket.sessionRPC).mockRejectedValue(new RpcError('Encryption unavailable', errorCode));
            await expect(sessionAbort(sessionId)).resolves.toBeUndefined();
            expect(thinkingMarkers().thinking).toBe(false);
            expect(thinkingMarkers().optimisticThinkingAt ?? null).toBeNull();
        },
    );
});
