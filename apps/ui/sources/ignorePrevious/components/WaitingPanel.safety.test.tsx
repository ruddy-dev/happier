import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';

import { renderScreen } from '@/dev/testkit';
import { createSessionFixture } from '@/dev/testkit/fixtures/sessionFixtures';
import { findTestInstanceByTypeContainingText, pressTestInstanceAsync } from '@/dev/testkit/render/renderScreen';
import { storage } from '@/sync/domains/state/storage';
import type { Session } from '@/sync/domains/state/storageTypes';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const state = vi.hoisted(() => ({
    rpc: vi.fn(),
    alert: vi.fn(),
    navigate: vi.fn(),
}));

vi.mock('@expo/vector-icons', async () => {
    const { createExpoVectorIconsMock } = await import('@/dev/testkit/mocks/icons');
    return createExpoVectorIconsMock();
});

vi.mock('expo-router', async () => {
    const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
    return createExpoRouterMock({ router: { navigate: state.navigate } }).module;
});

vi.mock('@/modal', async () => {
    const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
    return createModalModuleMock({ spies: { alert: state.alert } }).module;
});

vi.mock('@/sync/sync', async () => {
    const { installSyncStub } = await import('@/dev/testkit/mocks/sync');
    return installSyncStub()();
});

// The answer leaves the app here: the session RPC over the server socket. Everything above it is real.
vi.mock('@/sync/runtime/orchestration/serverScopedRpc/serverScopedSessionRpc', async (importOriginal) => {
    const { installServerScopedSessionRpcModuleMock } = await import('@/dev/testkit/mocks/serverScopedRpc');
    return installServerScopedSessionRpcModuleMock({
        sessionRpcWithServerScope: ((params: unknown) => state.rpc(params)) as never,
    })(importOriginal);
});

type RpcCall = { sessionId: string; method: string; payload: Record<string, unknown> };

function permissionCalls(): RpcCall[] {
    return state.rpc.mock.calls.map(([call]) => call as RpcCall).filter((call) => call.method === 'permission');
}

let previous: ReturnType<typeof storage.getState>;

/** A live session whose agent asks for one tool call. Neutral paths, no real ids. */
function sessionWithRequest(
    id: string,
    requestId: string,
    request: Record<string, unknown>,
    extra: Partial<Session> = {},
): Session {
    return createSessionFixture({
        id,
        active: true,
        metadata: {
            path: `/work/${id}`,
            host: 'desk-test',
            homeDir: '/work',
            machineId: 'desk-test-machine',
            summary: { text: `Worker ${id}`, updatedAt: 1 },
        } as Session['metadata'],
        agentState: { requests: { [requestId]: { createdAt: 10, ...request } } } as unknown as Session['agentState'],
        ...extra,
    });
}

/** Loads full records the way the first sync does, then marks the first sync finished. */
function seed(sessions: Session[]) {
    act(() => {
        storage.setState(previous, true);
        storage.getState().applySessions(sessions);
        storage.getState().applyReady();
    });
}

async function renderPanel() {
    const { WaitingPanel } = await import('./WaitingPanel');
    return renderScreen(<WaitingPanel />);
}

describe('WaitingPanel safety', () => {
    beforeEach(() => {
        previous = storage.getState();
        state.rpc.mockReset().mockResolvedValue({ ok: true });
        state.alert.mockReset();
        state.navigate.mockReset();
    });

    afterEach(() => {
        act(() => {
            storage.setState(previous, true);
        });
    });

    it("W3: Deny sends decision 'denied' so the agent refuses only this command", async () => {
        seed([sessionWithRequest('s1', 'r1', { tool: 'Bash', arguments: { command: 'npm test' } })]);
        const screen = await renderPanel();
        const deny = findTestInstanceByTypeContainingText(screen.tree, 'Pressable', 'Deny');
        await pressTestInstanceAsync(deny, 'Deny');
        const calls = permissionCalls();
        expect(calls).toHaveLength(1);
        expect(calls[0]).toMatchObject({
            sessionId: 's1',
            method: 'permission',
            payload: expect.objectContaining({ id: 'r1', approved: false, decision: 'denied' }),
        });
        expect(calls[0]!.payload.decision).not.toBe('abort');
    });
});
