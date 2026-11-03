import { revealWaitingDetails } from '../testkit/revealWaitingDetails';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import type { ReactTestInstance } from 'react-test-renderer';

import { renderScreen } from '@/dev/testkit';
import { createSessionFixture } from '@/dev/testkit/fixtures/sessionFixtures';
import { createDeferred } from '@/dev/testkit/hooks/createDeferred';
import { createPermissionActionDispatchGuard } from '@/components/tools/shell/permissions/permissionActionDispatchGuard';
import { findTestInstanceByTypeContainingText, pressTestInstanceAsync } from '@/dev/testkit/render/renderScreen';
import { Text } from '@/components/ui/text/Text';
import { buildSessionListRenderableFromSession } from '@/sync/domains/session/listing/sessionListRenderable';
import { storage } from '@/sync/domains/state/storage';
import { parsePlainSessionAgentState } from '@/sync/engine/sessions/parsePlainSessionPayload';
import type { Session } from '@/sync/domains/state/storageTypes';
import { t } from '@/text';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const state = vi.hoisted(() => ({
    rpc: vi.fn(),
    alert: vi.fn(),
    navigate: vi.fn(),
}));

// The stale-request note consumes the desk clock; this isolated panel is focused.
vi.mock('@react-navigation/native', async () => {
    const { createReactNavigationNativeMock } = await import('@/dev/testkit/mocks/reactNavigation');
    return createReactNavigationNativeMock();
});

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

/** Every string under an element, joined. */
function textUnder(node: ReactTestInstance | string | null): string {
    if (node === null) return '';
    if (typeof node === 'string') return node;
    return node.children.map(textUnder).join('');
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
        storage.getState().setSocketStatus('connected');
        storage.getState().applySessions(sessions);
        storage.getState().applyReady();
    });
}

/**
 * A sidebar row whose metadata the app could not decrypt or parse (`metadataUnavailable`), as the
 * list sync leaves it. The full record never loads, so the row is all the desk has.
 */
function seedUnreadableRow(id: string, pendingPermissionRequestCount: number, metadata: Record<string, unknown> | null = null) {
    const row = buildSessionListRenderableFromSession(
        createSessionFixture({ id, active: true, pendingPermissionRequestCount, pendingRequestObservedAt: Date.now() }),
    );
    act(() => {
        storage.setState(previous, true);
        storage.getState().setSocketStatus('connected');
        storage.getState().mergeSessionListRenderables([
            { ...row, metadata: metadata as typeof row.metadata, metadataUnavailable: true },
        ]);
        storage.getState().applyReady();
    });
}

function CountProbe() {
    const { useWaitingCount } = useDeskWaitsModule!;
    return <Text testID="probe-count">{String(useWaitingCount())}</Text>;
}

let useDeskWaitsModule: typeof import('../model/useDeskWaits') | null = null;

async function renderPanelWithCount() {
    const { WaitingPanel } = await import('./WaitingPanel');
    useDeskWaitsModule = await import('../model/useDeskWaits');
    return renderScreen(
        <>
            <WaitingPanel />
            <CountProbe />
        </>,
    );
}

const UNREADABLE = "The desk can't read this session's request. Open the session to look.";

async function renderPanel() {
    const { WaitingPanel } = await import('./WaitingPanel');
    const screen = await renderScreen(<WaitingPanel />);
    await revealWaitingDetails(screen);
    return screen;
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

    it('W1: each request shows its resolved issue or No issue', async () => {
        const tagged = sessionWithRequest('s1', 'r1', { tool: 'Bash', arguments: { command: 'npm test' } });
        tagged.metadata = { ...tagged.metadata!, tag: 'ATR-43-builder' } as Session['metadata'];
        seed([tagged, sessionWithRequest('s2', 'r2', { tool: 'Bash', arguments: { command: 'npm run lint' } })]);
        const screen = await renderPanel();
        expect(textUnder(screen.findByTestId('ip-waiting-issue-r1'))).toBe('ATR-43');
        expect(textUnder(screen.findByTestId('ip-waiting-issue-r2'))).toBe('No issue');
    });

    it.each([['allow', 'Allowed'], ['deny', 'Denied']] as const)('W1: a successful desk %s appears in Answered without action buttons', async (action, label) => {
        const session = sessionWithRequest('s1', 'answered-local', { tool: 'Bash', arguments: { command: 'npm test' } });
        seed([session]);
        const screen = await renderPanel();
        expect(screen.findByTestId('ip-waiting-card-answered-local')).not.toBeNull();
        await pressTestInstanceAsync(screen.findByTestId(`ip-waiting-${action}-answered-local`), action);
        act(() => {
            storage.getState().applySessions([{ ...session, agentStateVersion: session.agentStateVersion + 1, agentState: { requests: {} } }]);
        });
        expect(textUnder(screen.findByTestId('ip-answered-answered-local'))).toContain(label);
        expect(screen.getTextContent()).not.toContain('Answered elsewhere');
        expect(screen.getTextContent()).toContain('npm test');
        expect(screen.findByTestId('ip-waiting-card-answered-local')).toBeNull();
        expect(screen.findByTestId('ip-waiting-allow-answered-local')).toBeNull();
    });

    it('D1: reopening the drawer keeps at most four answers from this desk page', async () => {
        const sessions = Array.from({ length: 5 }, (_, index) => sessionWithRequest(`history-${index}`, `history-${index}`, { tool: 'Bash', arguments: { command: `task ${index}` } }));
        seed(sessions);
        const { WaitingPanel, createWaitingHistory } = await import('./WaitingPanel');
        const history = createWaitingHistory();
        const first = await renderScreen(<WaitingPanel history={history} />);
        act(() => first.tree.unmount());
        act(() => storage.getState().applySessions(sessions.map((session) => ({
            ...session, agentStateVersion: session.agentStateVersion + 1, agentState: { requests: {} },
        }))));
        const reopened = await renderScreen(<WaitingPanel history={history} />);
        expect(reopened.getTextContent().split('No longer waiting')).toHaveLength(5);
        expect(sessions.filter((session) => reopened.findByTestId(`ip-answered-${session.id}`))).toHaveLength(4);
    });

    it('D1: a canceled completion is neutrally described as no longer waiting', async () => {
        const session = sessionWithRequest('canceled-session', 'canceled-request', { tool: 'Bash', arguments: { command: 'task' } });
        seed([session]);
        const screen = await renderPanel();
        act(() => storage.getState().applySessions([{ ...session, agentStateVersion: session.agentStateVersion + 1,
            agentState: { requests: {}, completedRequests: { 'canceled-request': { tool: 'Bash', arguments: { command: 'task' }, createdAt: 10, completedAt: 20, status: 'canceled' } } },
        }]));
        expect(textUnder(screen.findByTestId('ip-answered-canceled-request'))).toContain('No longer waiting');
        expect(screen.getTextContent()).not.toContain('Answered elsewhere');
    });

    it.each([['approved', 'Allowed'], ['denied', 'Denied']] as const)('D1: a %s completion is answered elsewhere with its decision', async (status, label) => {
        const session = sessionWithRequest('remote', 'remote-request', { tool: 'Bash', arguments: { command: 'task' } });
        seed([session]);
        const screen = await renderPanel();
        act(() => storage.getState().applySessions([{ ...session, agentStateVersion: session.agentStateVersion + 1,
            agentState: { requests: {}, completedRequests: { 'remote-request': { tool: 'Bash', arguments: { command: 'task' }, createdAt: 10, completedAt: 20, status } } },
        }]));
        const answer = textUnder(screen.findByTestId('ip-answered-remote-request'));
        expect(answer).toContain('Answered elsewhere');
        expect(answer).toContain(label);
        expect(answer).not.toContain('No longer waiting');
    });

    it('D1: a disappearance without a completion is no longer waiting', async () => {
        const session = sessionWithRequest('unknown', 'unknown-request', { tool: 'Bash', arguments: { command: 'task' } });
        seed([session]);
        const screen = await renderPanel();
        act(() => storage.getState().applySessions([{ ...session, agentStateVersion: session.agentStateVersion + 1, agentState: { requests: {} } }]));
        expect(textUnder(screen.findByTestId('ip-answered-unknown-request'))).toContain('No longer waiting');
        expect(screen.getTextContent()).not.toContain('Answered elsewhere');
    });

    it('D1: a session ending does not create an Answered entry', async () => {
        const session = sessionWithRequest('ending', 'ending-request', { tool: 'Bash', arguments: { command: 'task' } });
        seed([session]);
        const screen = await renderPanel();
        expect(screen.findByTestId('ip-waiting-allow-ending-request')).not.toBeNull();
        act(() => storage.getState().applySessions([{ ...session, active: false,
            agentStateVersion: session.agentStateVersion + 1, agentState: { requests: {} },
        }]));
        expect(screen.findByTestId('ip-waiting-allow-ending-request')).toBeNull();
        expect(screen.findByTestId('ip-answered-ending-request')).toBeNull();
        expect(screen.findByTestId('ip-waiting-empty')).not.toBeNull();
    });

    it.each([false, true])('D1 W6: unreadable or not-loaded request details do not create history, transcript loaded=%s', async (loaded) => {
        const session = sessionWithRequest('reloading', 'reloading-request', { tool: 'Bash', arguments: { command: 'task' } });
        seed([session]);
        const screen = await renderPanel();
        expect(screen.findByTestId('ip-waiting-allow-reloading-request')).not.toBeNull();
        act(() => {
            storage.getState().applySessions([{ ...session, agentStateVersion: session.agentStateVersion + 1,
                agentState: {}, pendingPermissionRequestCount: 1, pendingRequestObservedAt: Date.now(),
            }]);
            if (loaded) storage.getState().applyMessagesLoaded(session.id);
        });
        expect(screen.findByTestId('ip-waiting-allow-reloading-request')).toBeNull();
        expect(screen.getTextContent()).toContain(loaded ? UNREADABLE : 'Waiting on you. Open the session to see what.');
        expect(screen.findByTestId('ip-answered-reloading-request')).toBeNull();
    });

    it('D1: a returned request leaves Answered while it waits again', async () => {
        const session = sessionWithRequest('returning', 'returning-request', { tool: 'Bash', arguments: { command: 'task' } });
        seed([session]);
        const screen = await renderPanel();
        act(() => storage.getState().applySessions([{ ...session, agentStateVersion: session.agentStateVersion + 1, agentState: { requests: {} } }]));
        expect(screen.findByTestId('ip-answered-returning-request')).not.toBeNull();
        act(() => storage.getState().applySessions([{ ...session, agentStateVersion: session.agentStateVersion + 2 }]));
        await revealWaitingDetails(screen);
        expect(screen.findByTestId('ip-waiting-allow-returning-request')).not.toBeNull();
        expect(screen.findByTestId('ip-answered-returning-request')).toBeNull();
    });

    it('D1: disappearance before the RPC resolves shows the local outcome only once', async () => {
        const gate = createDeferred<{ ok: true }>();
        state.rpc.mockImplementation(async (call: RpcCall) => call.method === 'permission' ? gate.promise : { ok: true });
        const session = sessionWithRequest('racing', 'racing-request', { tool: 'Bash', arguments: { command: 'task' } });
        seed([session]);
        const screen = await renderPanel();
        await pressTestInstanceAsync(screen.findByTestId('ip-waiting-allow-racing-request'), 'allow');
        try {
            act(() => storage.getState().applySessions([{ ...session, agentStateVersion: session.agentStateVersion + 1,
                agentState: { requests: {}, completedRequests: { 'racing-request': { tool: 'Bash', arguments: { command: 'task' }, createdAt: 10, completedAt: 20, status: 'approved' } } },
            }]));
            expect(textUnder(screen.findByTestId('ip-answered-racing-request'))).toContain('Answered elsewhere');
        } finally {
            await act(async () => { gate.resolve({ ok: true }); });
        }
        const answer = textUnder(screen.findByTestId('ip-answered-racing-request'));
        expect(answer.split('Allowed')).toHaveLength(2);
        expect(answer).not.toContain('Answered elsewhere');
        expect(screen.findByTestId('ip-waiting-allow-racing-request')).toBeNull();
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

    // Each W2 test uses its own request id: the dispatch guard's registry is module-wide, and every
    // deferred is resolved before the test ends so no entry outlives its card.
    it('W2: pressing Allow twice sends one permission answer', async () => {
        const gate = createDeferred<{ ok: true }>();
        state.rpc.mockImplementation(async (call: RpcCall) => (call.method === 'permission' ? gate.promise : { ok: true }));
        seed([sessionWithRequest('s1', 'r2', { tool: 'Bash', arguments: { command: 'npm test' } })]);
        const screen = await renderPanel();
        await pressTestInstanceAsync(screen.findByTestId('ip-waiting-allow-r2'), 'allow');
        await pressTestInstanceAsync(screen.findByTestId('ip-waiting-allow-r2'), 'allow');
        expect(permissionCalls()).toHaveLength(1);
        expect(screen.findByTestId('ip-waiting-allow-r2')?.props.accessibilityState).toMatchObject({ disabled: true, busy: true });
        expect(screen.findByTestId('ip-waiting-deny-r2')?.props.accessibilityState).toMatchObject({ disabled: true, busy: true });
        // A refused second press is silent: nothing failed, and this card is the one answering.
        expect(state.alert).not.toHaveBeenCalled();
        expect(screen.findByTestId('ip-waiting-elsewhere-r2')).toBeNull();
        await act(async () => {
            gate.resolve({ ok: true });
        });
        expect(state.alert).not.toHaveBeenCalled();
    });

    it('W2: Deny while Allow is in flight does nothing', async () => {
        const gate = createDeferred<{ ok: true }>();
        state.rpc.mockImplementation(async (call: RpcCall) => (call.method === 'permission' ? gate.promise : { ok: true }));
        seed([sessionWithRequest('s1', 'r3', { tool: 'Bash', arguments: { command: 'npm test' } })]);
        const screen = await renderPanel();
        await pressTestInstanceAsync(screen.findByTestId('ip-waiting-allow-r3'), 'allow');
        await pressTestInstanceAsync(screen.findByTestId('ip-waiting-deny-r3'), 'deny');
        const calls = permissionCalls();
        expect(calls).toHaveLength(1);
        expect(calls[0]!.payload).toMatchObject({ id: 'r3', approved: true });
        await act(async () => {
            gate.resolve({ ok: true });
        });
    });

    it('W2: once an answer is sent the card cannot send a second, different one', async () => {
        seed([sessionWithRequest('s1', 'r7', { tool: 'Bash', arguments: { command: 'npm test' } })]);
        const screen = await renderPanel();
        await pressTestInstanceAsync(screen.findByTestId('ip-waiting-allow-r7'), 'allow');
        await pressTestInstanceAsync(screen.findByTestId('ip-waiting-deny-r7'), 'deny');
        expect(permissionCalls()).toHaveLength(1);
        // The card stays until the session drops the request; its buttons say they won't act.
        expect(screen.findByTestId('ip-waiting-deny-r7')?.props.accessibilityState).toMatchObject({ disabled: true });
    });

    it('W2: a failed send can be retried', async () => {
        state.rpc.mockImplementationOnce(async () => {
            throw new Error('network down');
        });
        seed([sessionWithRequest('s1', 'r4', { tool: 'Bash', arguments: { command: 'npm test' } })]);
        const screen = await renderPanel();
        await pressTestInstanceAsync(screen.findByTestId('ip-waiting-allow-r4'), 'allow');
        expect(screen.findByTestId('ip-waiting-allow-r4')?.props.accessibilityState).toMatchObject({ disabled: false, busy: false });
        await pressTestInstanceAsync(screen.findByTestId('ip-waiting-allow-r4'), 'allow');
        expect(permissionCalls()).toHaveLength(2);
    });

    it('W2: a request already in flight from the transcript footer is not re-sent', async () => {
        const gate = createDeferred<void>();
        seed([sessionWithRequest('s1', 'r5', { tool: 'Bash', arguments: { command: 'npm test' } })]);
        const screen = await renderPanel();
        // The session's own footer arbitrates the same request through the same key.
        const footer = createPermissionActionDispatchGuard('s1\u0000r5');
        const footerSend = footer.dispatch('s1\u0000r5', () => gate.promise);
        await pressTestInstanceAsync(screen.findByTestId('ip-waiting-allow-r5'), 'allow');
        expect(permissionCalls()).toHaveLength(0);
        expect(state.alert).not.toHaveBeenCalled();
        gate.resolve();
        await expect(footerSend).resolves.toBe(true);
    });

    it('F4: refused-press feedback remains truthful after the retained footer finishes', async () => {
        const gate = createDeferred<void>();
        seed([sessionWithRequest('s1', 'r18', { tool: 'Bash', arguments: { command: 'npm test' } })]);
        const screen = await renderPanel();
        const footer = createPermissionActionDispatchGuard('s1\u0000r18');
        footer.retainRequest('s1\u0000r18');
        const footerSend = footer.dispatch('s1\u0000r18', () => gate.promise);
        try {
            expect(screen.findByTestId('ip-waiting-elsewhere-r18')).toBeNull();
            await pressTestInstanceAsync(screen.findByTestId('ip-waiting-allow-r18'), 'allow');
            expect(screen.findByTestId('ip-waiting-elsewhere-r18')).not.toBeNull();
            await act(async () => { gate.resolve(); await footerSend; });
            await pressTestInstanceAsync(screen.findByTestId('ip-waiting-allow-r18'), 'allow');
            expect(permissionCalls()).toHaveLength(0);
            const note = textUnder(screen.findByTestId('ip-waiting-elsewhere-r18'));
            expect(note).not.toMatch(/already answering/i);
            expect(note).toContain('Open the session');
            expect(screen.findByTestId('ip-waiting-allow-r18')?.props.accessibilityState).toMatchObject({ disabled: false });
        } finally {
            gate.resolve();
            await footerSend;
            footer.releaseRequest('s1\u0000r18');
        }
    });

    it('C: after a desk answer settles, the session footer can still answer a request that has not left', async () => {
        seed([sessionWithRequest('s1', 'r16', { tool: 'Bash', arguments: { command: 'npm test' } })]);
        const screen = await renderPanel();
        // The session is open on top of the desk: its footer is mounted and holds the same request.
        const footer = createPermissionActionDispatchGuard('s1\u0000r16');
        footer.retainRequest('s1\u0000r16');
        await pressTestInstanceAsync(screen.findByTestId('ip-waiting-allow-r16'), 'allow');
        expect(permissionCalls()).toHaveLength(1);
        // The answer was sent, but the agent never dropped the request: the desk card stays, sent.
        expect(screen.findByTestId('ip-waiting-allow-r16')?.props.accessibilityState).toMatchObject({ disabled: true });
        const footerAction = vi.fn(async () => {});
        await expect(footer.dispatch('s1\u0000r16', footerAction)).resolves.toBe(true);
        expect(footerAction).toHaveBeenCalledTimes(1);
        footer.releaseRequest('s1\u0000r16');
    });

    it('C: after a desk answer settles and the desk closes, the footer still answers', async () => {
        seed([sessionWithRequest('s1', 'r17', { tool: 'Bash', arguments: { command: 'npm test' } })]);
        const screen = await renderPanel();
        const footer = createPermissionActionDispatchGuard('s1\u0000r17');
        footer.retainRequest('s1\u0000r17');
        await pressTestInstanceAsync(screen.findByTestId('ip-waiting-allow-r17'), 'allow');
        act(() => {
            screen.tree.unmount();
        });
        const footerAction = vi.fn(async () => {});
        await expect(footer.dispatch('s1\u0000r17', footerAction)).resolves.toBe(true);
        footer.releaseRequest('s1\u0000r17');
    });

    it('J3: a network error on Allow says the answer did not go through, not "already answered"', async () => {
        state.rpc.mockImplementation(async (call: RpcCall) => {
            if (call.method === 'permission') throw new Error('network down');
            return { ok: true };
        });
        seed([sessionWithRequest('s1', 'r8', { tool: 'Bash', arguments: { command: 'npm test' } })]);
        const screen = await renderPanel();
        await pressTestInstanceAsync(screen.findByTestId('ip-waiting-allow-r8'), 'allow');
        expect(state.alert).toHaveBeenCalledWith(
            'Answer not sent',
            "Your answer didn't go through. Check the connection and try again.",
        );
        expect(JSON.stringify(state.alert.mock.calls)).not.toMatch(/already answered|expired/i);
    });

    it.each(['permission_request_not_found', 'permission_request_expired'])('D1 M4: %s alerts and leaves the transcript footer able to answer', async (errorCode) => {
        state.rpc.mockResolvedValue({ ok: false, errorCode });
        seed([sessionWithRequest('s1', 'r9', { tool: 'Bash', arguments: { command: 'npm test' } })]);
        const screen = await renderPanel();
        const key = 's1\u0000r9';
        const footer = createPermissionActionDispatchGuard(key);
        footer.retainRequest(key);
        try {
            await pressTestInstanceAsync(screen.findByTestId('ip-waiting-allow-r9'), 'allow');
            expect(state.alert).toHaveBeenCalledWith(
                'Request no longer available',
                'This request was already answered or has expired. Open the session to check.',
            );
            expect(state.alert).toHaveBeenCalledWith(t('ignorePrevious.waiting.alreadyAnsweredTitle'), t('ignorePrevious.waiting.alreadyAnswered'));
            // This card stays unavailable, while the independent session footer remains usable.
            expect(screen.findByTestId('ip-waiting-allow-r9')?.props.accessibilityState).toMatchObject({ disabled: true });
            const action = vi.fn(async () => {});
            await expect(footer.dispatch(key, action)).resolves.toBe(true);
            expect(action).toHaveBeenCalledTimes(1);
        } finally {
            footer.releaseRequest(key);
        }
    });

    it('D1 M4: permission_response_failed gets the generic alert and can retry', async () => {
        state.rpc.mockResolvedValue({ ok: false, errorCode: 'permission_response_failed' });
        seed([sessionWithRequest('s1', 'generic-failure', { tool: 'Bash', arguments: { command: 'task' } })]);
        const screen = await renderPanel();
        await pressTestInstanceAsync(screen.findByTestId('ip-waiting-allow-generic-failure'), 'allow');
        expect(state.alert).toHaveBeenCalledWith(t('ignorePrevious.waiting.answerFailedTitle'), t('ignorePrevious.waiting.answerFailed'));
        expect(screen.findByTestId('ip-waiting-allow-generic-failure')?.props.accessibilityState).toMatchObject({ disabled: false, busy: false });
        state.rpc.mockResolvedValue({ ok: true });
        await pressTestInstanceAsync(screen.findByTestId('ip-waiting-allow-generic-failure'), 'allow');
        expect(permissionCalls()).toHaveLength(2);
    });

    it('W1: the card shows a 300-character command including its tail', async () => {
        const command = 'cd build && ' + 'echo a '.repeat(40) + '&& rm -rf /tmp/x';
        seed([sessionWithRequest('s1', 'r10', { tool: 'Bash', arguments: { command } })]);
        const screen = await renderPanel();
        const waiting = textUnder(screen.findByTestId('ip-waiting-detail-r10'));
        expect(command.length).toBeGreaterThan(290);
        expect(waiting).toContain(command);
        expect(waiting).not.toContain('…');
    });

    it('W1: a CodexBash argv request shows its command', async () => {
        seed([sessionWithRequest('s1', 'r11', { tool: 'CodexBash', arguments: { command: ['bash', '-lc', 'git push --force'] } })]);
        const screen = await renderPanel();
        const waiting = textUnder(screen.findByTestId('ip-waiting'));
        expect(waiting).toContain('git push --force');
    });

    it('W1: a WebFetch request shows its arguments', async () => {
        seed([sessionWithRequest('s1', 'r12', { tool: 'WebFetch', arguments: { url: 'https://example.invalid/x' } })]);
        const screen = await renderPanel();
        expect(textUnder(screen.findByTestId('ip-waiting'))).toContain('https://example.invalid/x');
    });

    it('W9: a view-only session shows no Allow or Deny', async () => {
        seed([sessionWithRequest('s1', 'r13', { tool: 'Bash', arguments: { command: 'npm test' } }, { accessLevel: 'view' })]);
        const screen = await renderPanel();
        expect(screen.findByTestId('ip-waiting-allow-r13')).toBeNull();
        expect(screen.findByTestId('ip-waiting-deny-r13')).toBeNull();
        const waiting = textUnder(screen.findByTestId('ip-waiting'));
        expect(waiting).toContain('You have view-only access to this session.');
        expect(waiting).toContain('npm test');
        await pressTestInstanceAsync(findTestInstanceByTypeContainingText(screen.tree, 'Pressable', 'Open session'), 'Open session');
        expect(String(state.navigate.mock.calls[0]?.[0])).toMatch(/^\/session\/s1(\?|$)/);
        expect(permissionCalls()).toHaveLength(0);
    });

    it('W9: edit access without approval rights says the owner did not allow it', async () => {
        seed([
            sessionWithRequest('s1', 'r14', { tool: 'Bash', arguments: { command: 'npm test' } }, { accessLevel: 'edit', canApprovePermissions: false }),
        ]);
        const screen = await renderPanel();
        expect(screen.findByTestId('ip-waiting-allow-r14')).toBeNull();
        expect(screen.findByTestId('ip-waiting-deny-r14')).toBeNull();
        expect(textUnder(screen.findByTestId('ip-waiting'))).toContain(
            'The owner did not allow you to approve permissions for this session.',
        );
    });

    it('W9: edit access with approval rights keeps the buttons', async () => {
        seed([
            sessionWithRequest('s1', 'r15', { tool: 'Bash', arguments: { command: 'npm test' } }, { accessLevel: 'edit', canApprovePermissions: true }),
        ]);
        const screen = await renderPanel();
        expect(screen.findByTestId('ip-waiting-allow-r15')).toBeTruthy();
        expect(screen.findByTestId('ip-waiting-deny-r15')).toBeTruthy();
    });

    it('W6: a session with unreadable metadata and a pending request shows a needs-a-look row', async () => {
        seedUnreadableRow('u1', 1);
        const screen = await renderPanelWithCount();
        const waiting = textUnder(screen.findByTestId('ip-waiting'));
        expect(waiting).toContain(UNREADABLE);
        expect(waiting).not.toContain('Allow');
        expect(waiting).not.toContain('Deny');
        expect(textUnder(screen.findByTestId('probe-count'))).toBe('1');
        await pressTestInstanceAsync(findTestInstanceByTypeContainingText(screen.tree, 'Pressable', 'Open session'), 'Open session');
        expect(String(state.navigate.mock.calls[0]?.[0])).toMatch(/^\/session\/u1(\?|$)/);
    });

    it('W6: an unreadable session with nothing pending is not listed', async () => {
        seedUnreadableRow('u2', 0);
        const screen = await renderPanelWithCount();
        expect(screen.findByTestId('ip-waiting')).toBeNull();
        expect(screen.findByTestId('ip-waiting-empty')).toBeTruthy();
        expect(textUnder(screen.findByTestId('probe-count'))).toBe('0');
    });

    it('W6: a hidden system session stays hidden', async () => {
        seedUnreadableRow('u3', 1, { path: '/work/system', host: 'desk-test', hiddenSystemSession: true });
        const screen = await renderPanelWithCount();
        expect(screen.findByTestId('ip-waiting')).toBeNull();
        expect(textUnder(screen.findByTestId('probe-count'))).toBe('0');
    });

    it('S: an agentState that parses to {} with a pending count shows the unreadable row, not a card', async () => {
        // 'Zm9vYmFy' is not JSON, so the parser falls back to {}: the request is lost, the count is not.
        const agentState = parsePlainSessionAgentState('Zm9vYmFy');
        expect(agentState).toEqual({});
        seed([
            sessionWithRequest('s1', 'unused', { tool: 'Bash' }, {
                agentState,
                pendingPermissionRequestCount: 1,
                pendingRequestObservedAt: Date.now(),
            }),
        ]);
        // The transcript has loaded and holds nothing either: the desk has all the app can read.
        // Before it loads, the row keeps the "open the session to see what" copy (WaitingPanel.transcript.test).
        act(() => {
            storage.getState().applyMessagesLoaded('s1');
        });
        const screen = await renderPanelWithCount();
        const waiting = textUnder(screen.findByTestId('ip-waiting'));
        expect(waiting).toContain(UNREADABLE);
        expect(waiting).not.toContain('Allow');
        expect(textUnder(screen.findByTestId('probe-count'))).toBe('1');
    });

    it.todo('Spike S case c: agentState written by REST PATCH without a count update is invisible to the desk. Does the product want an upstream marker from parsePlainSessionAgentState?');
});
