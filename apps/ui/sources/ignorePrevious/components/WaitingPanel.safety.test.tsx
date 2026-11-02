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

const UNREADABLE = "The desk can't read this session's request. Open the session to answer it.";

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
        // A refused second press is silent: nothing failed.
        expect(state.alert).not.toHaveBeenCalled();
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

    // Characterises today's gap: sessionAllow drops the CLI's reply, so an {ok:false} looks like success.
    it('D1: a { ok: false } reply raises no alert today', async () => {
        state.rpc.mockResolvedValue({ ok: false, errorCode: 'permission_request_not_found', errorMessage: 'request not found' });
        seed([sessionWithRequest('s1', 'r9', { tool: 'Bash', arguments: { command: 'npm test' } })]);
        const screen = await renderPanel();
        await pressTestInstanceAsync(screen.findByTestId('ip-waiting-allow-r9'), 'allow');
        expect(permissionCalls()).toHaveLength(1);
        expect(state.alert).not.toHaveBeenCalled();
    });

    it.todo('D1: should an { ok:false } reply show "already answered" or silently drop the card? (Seam PR, sessionAllowResult)');

    it('W1: the card shows a 300-character command including its tail', async () => {
        const command = 'cd build && ' + 'echo a '.repeat(40) + '&& rm -rf /tmp/x';
        seed([sessionWithRequest('s1', 'r10', { tool: 'Bash', arguments: { command } })]);
        const screen = await renderPanel();
        const waiting = textUnder(screen.findByTestId('ip-waiting'));
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
