import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDeferred } from '@/dev/testkit/hooks/createDeferred';
import { findTestInstanceByTypeContainingText, pressTestInstanceAsync } from '@/dev/testkit/render/renderScreen';

import { loadDeskScript, startDeskScenario, type DeskScenario } from '../testkit/deskScenario';
import raw from '../testkit/scripts/W2-double-allow.json';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const state = vi.hoisted(() => ({
    rpc: vi.fn(),
    alert: vi.fn(),
}));

vi.mock('@expo/vector-icons', async () => {
    const { createExpoVectorIconsMock } = await import('@/dev/testkit/mocks/icons');
    return createExpoVectorIconsMock();
});

// The desk clock pauses while another screen covers the desk; here the desk is always focused.
vi.mock('@react-navigation/native', async () => {
    const { createReactNavigationNativeMock } = await import('@/dev/testkit/mocks/reactNavigation');
    return createReactNavigationNativeMock();
});

vi.mock('expo-router', async () => {
    const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
    return createExpoRouterMock().module;
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

vi.mock('@/hooks/ui/useReducedMotionPreference', async () => {
    const { installReducedMotionMock } = await import('@/dev/testkit/mocks/reducedMotion');
    return installReducedMotionMock(false)();
});

vi.mock('@/components/sessions/shell/SessionView', async () => {
    const { deskScreenMocks } = await import('../testkit/deskScreenMocks');
    return deskScreenMocks.sessionView();
});

vi.mock('@/hooks/session/useHydrateSessionForRoute', async () => {
    const { deskScreenMocks } = await import('../testkit/deskScreenMocks');
    return deskScreenMocks.hydrateSessionForRoute();
});

/** Worker w1 asks to run one command (r1); the approvals drawer is open beside the coordinator. */
const script = loadDeskScript(raw);

describe('WaitingPanel double Allow (W2)', () => {
    let scenario: DeskScenario | null = null;
    beforeEach(() => {
        state.rpc.mockReset();
        state.alert.mockReset();
    });
    afterEach(async () => {
        await scenario?.dispose();
        scenario = null;
    });

    it('W2: one tap on Allow sends one permission answer for that request', async () => {
        state.rpc.mockResolvedValue(undefined);
        scenario = await startDeskScenario({ script, coordinator: 'c1' });
        await scenario.openApprovals();
        await scenario.screen.pressByTestIdAsync('ip-waiting-toggle-r1');
        const allow = findTestInstanceByTypeContainingText(scenario.screen.tree, 'Pressable', 'Allow Bash');
        await pressTestInstanceAsync(allow, 'Allow Bash');
        expect(state.rpc).toHaveBeenCalledTimes(1);
        expect(state.rpc.mock.calls[0]![0]).toMatchObject({ sessionId: 'w1', method: 'permission', payload: { id: 'r1', approved: true } });
        expect(state.alert).not.toHaveBeenCalled();
    });

    it('W2: a second tap while the first answer is in flight sends nothing', async () => {
        const inFlight = createDeferred<undefined>();
        state.rpc.mockReturnValue(inFlight.promise);
        scenario = await startDeskScenario({ script, coordinator: 'c1' });
        await scenario.openApprovals();
        await scenario.screen.pressByTestIdAsync('ip-waiting-toggle-r1');
        await scenario.screen.pressByTestIdAsync('ip-waiting-allow-r1');
        await scenario.screen.pressByTestIdAsync('ip-waiting-allow-r1');
        inFlight.resolve(undefined);
        await scenario.advance(0);
        expect(state.rpc).toHaveBeenCalledTimes(1);
        expect(state.rpc.mock.calls[0]![0]).toMatchObject({ sessionId: 'w1', method: 'permission', payload: { id: 'r1', approved: true } });
        // The second tap must not end in "Answer not sent".
        expect(state.alert).not.toHaveBeenCalled();
    });

    it.todo('W2 Q2 what Allow shows when the agent replies {ok:false}');
});

// These scenarios exercise the concurrent desktop panes. Phone navigation has its own tests.
vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock({ useWindowDimensions: () => ({ width: 1440, height: 900, scale: 1, fontScale: 1 }) });
});
