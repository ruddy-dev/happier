import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Session } from '@/sync/domains/state/storageTypes';
import { storage } from '@/sync/domains/state/storage';

const { mockSessionRpcWithPreferredSessionScope } = vi.hoisted(() => ({
    mockSessionRpcWithPreferredSessionScope: vi.fn(),
}));

vi.mock('@/sync/runtime/orchestration/serverScopedRpc/sessionRpcWithPreferredSessionScope', () => ({
    sessionRpcWithPreferredSessionScope: (...args: unknown[]) => mockSessionRpcWithPreferredSessionScope(...args),
}));

// sessions.ts imports sync, which pulls native modules in node/vitest.
vi.mock('../sync', () => ({
    sync: {
        encryption: {
            getSessionEncryption: () => null,
            getMachineEncryption: () => null,
        },
    },
}));

import { sessionAllow, sessionAllowResult, sessionDeny, sessionDenyResult } from './sessions';

const initialStorageState = storage.getState();

function buildSession(sessionId: string): Session {
    return {
        id: sessionId,
        seq: 1,
        createdAt: 1,
        updatedAt: 1,
        active: true,
        activeAt: 1,
        metadata: null,
        metadataVersion: 0,
        agentState: null,
        agentStateVersion: 0,
        thinking: true,
        thinkingAt: 1,
        presence: 'online',
    };
}

describe('permission results', () => {
    beforeEach(() => {
        storage.setState(initialStorageState, true);
        mockSessionRpcWithPreferredSessionScope.mockReset();
    });

    it('D1 sessionDenyResult returns ok:false permission_request_not_found when the request was answered elsewhere', async () => {
        const failure = {
            ok: false,
            errorCode: 'permission_request_not_found',
            errorMessage: 'gone',
            requestId: 'perm_1',
        };
        mockSessionRpcWithPreferredSessionScope.mockResolvedValue(failure);

        await expect(sessionDenyResult('s1', 'perm_1')).resolves.toEqual(failure);
    });

    it('D1 sessionAllowResult returns ok:false permission_request_expired', async () => {
        const failure = {
            ok: false,
            errorCode: 'permission_request_expired',
            errorMessage: 'too late',
            requestId: 'perm_1',
        };
        mockSessionRpcWithPreferredSessionScope.mockResolvedValue(failure);

        await expect(sessionAllowResult('s1', 'perm_1')).resolves.toEqual(failure);
    });

    it('D1 sessionAllowResult returns {ok:true}', async () => {
        mockSessionRpcWithPreferredSessionScope.mockResolvedValue({ ok: true });

        await expect(sessionAllowResult('s1', 'perm_1')).resolves.toEqual({ ok: true });
        expect(mockSessionRpcWithPreferredSessionScope).toHaveBeenCalledWith({
            sessionId: 's1',
            method: 'permission',
            payload: expect.objectContaining({ id: 'perm_1', approved: true }),
        });
    });

    it('W3 sessionDenyResult sends decision denied', async () => {
        mockSessionRpcWithPreferredSessionScope.mockResolvedValue({ ok: true });

        await sessionDenyResult('s1', 'perm_1', undefined, undefined, 'denied');

        expect(mockSessionRpcWithPreferredSessionScope).toHaveBeenCalledWith({
            sessionId: 's1',
            method: 'permission',
            payload: expect.objectContaining({ id: 'perm_1', approved: false, decision: 'denied' }),
        });
    });

    it("W2 a second sessionDenyResult for the same id returns the CLI's ok:false instead of throwing", async () => {
        mockSessionRpcWithPreferredSessionScope.mockResolvedValueOnce({ ok: true });
        mockSessionRpcWithPreferredSessionScope.mockResolvedValueOnce({
            ok: false,
            errorCode: 'permission_request_not_found',
            errorMessage: 'already answered',
            requestId: 'perm_1',
        });

        await expect(sessionDenyResult('s1', 'perm_1', undefined, undefined, 'denied')).resolves.toEqual({ ok: true });
        await expect(sessionDenyResult('s1', 'perm_1', undefined, undefined, 'denied')).resolves.toMatchObject({
            ok: false,
            errorCode: 'permission_request_not_found',
        });
    });

    it('D1 sessionDenyResult rejects when the RPC throws', async () => {
        mockSessionRpcWithPreferredSessionScope.mockRejectedValue(new Error('rpc down'));

        await expect(sessionDenyResult('s1', 'perm_1')).rejects.toThrow('rpc down');
    });

    it('D1 a legacy CLI resolving undefined counts as ok:true (R8)', async () => {
        mockSessionRpcWithPreferredSessionScope.mockResolvedValue(undefined);

        await expect(sessionAllowResult('s1', 'perm_1')).resolves.toEqual({ ok: true });
        await expect(sessionDenyResult('s1', 'perm_1')).resolves.toEqual({ ok: true });
    });

    it('D1 sessionDeny and sessionAllow still resolve void when the CLI says ok:false', async () => {
        mockSessionRpcWithPreferredSessionScope.mockResolvedValue({
            ok: false,
            errorCode: 'permission_request_not_found',
            errorMessage: 'gone',
            requestId: 'perm_1',
        });

        await expect(sessionDeny('s1', 'perm_1')).resolves.toBeUndefined();
        await expect(sessionAllow('s1', 'perm_1')).resolves.toBeUndefined();
    });

    it('D1 an ok:false reply with missing fields gets errorCode unknown and the asked-for request id', async () => {
        mockSessionRpcWithPreferredSessionScope.mockResolvedValue({ ok: false });

        await expect(sessionAllowResult('s1', 'perm_9')).resolves.toEqual({
            ok: false,
            errorCode: 'unknown',
            errorMessage: '',
            requestId: 'perm_9',
        });
    });

    it('W3 sessionDenyResult clears optimistic thinking on denied', async () => {
        const sessionId = 's_permission_result_deny';
        storage.getState().applySessions([buildSession(sessionId)]);
        storage.getState().markSessionOptimisticThinking(sessionId);
        mockSessionRpcWithPreferredSessionScope.mockResolvedValue({ ok: true });
        expect(storage.getState().sessions[sessionId]?.thinking).toBe(true);

        await sessionDenyResult(sessionId, 'perm_1', undefined, undefined, 'denied');

        const session = storage.getState().sessions[sessionId];
        expect(session?.thinking).toBe(false);
        expect(session?.optimisticThinkingAt ?? null).toBeNull();
    });

    it('R9 sessionDenyResult still clears thinking when the CLI answers ok:false', async () => {
        const sessionId = 's_permission_result_deny_failed';
        storage.getState().applySessions([buildSession(sessionId)]);
        mockSessionRpcWithPreferredSessionScope.mockResolvedValue({
            ok: false,
            errorCode: 'permission_request_expired',
            errorMessage: 'too late',
            requestId: 'perm_1',
        });

        await sessionDenyResult(sessionId, 'perm_1', undefined, undefined, 'denied');

        expect(storage.getState().sessions[sessionId]?.thinking).toBe(false);
    });
});
