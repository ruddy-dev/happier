import { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { findTestInstanceByTypeContainingText, pressTestInstanceAsync } from '@/dev/testkit/render/renderScreen';
import { SESSION_RUNTIME_STATUS_STALE_SIGNAL_MS } from '@/sync/domains/session/attention/deriveSessionRuntimePresentationState';
import { createMachineFixture } from '@/dev/testkit/fixtures/machineFixtures';
import { subscribeToNowMs } from '@/hooks/time/nowMsClockStore';
import { DESK_TICK_MS } from '../model/useDeskNow';
import { storage } from '@/sync/domains/state/storage';

import { loadDeskScript, startDeskScenario, type DeskScenario } from '../testkit/deskScenario';
import raw from '../testkit/scripts/F1-F2-crashed-worker.json';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;


const boundary = vi.hoisted(() => ({ rpc: vi.fn(), alert: vi.fn() }));

vi.mock('@/sync/runtime/orchestration/serverScopedRpc/serverScopedSessionRpc', async (importOriginal) => {
    const { installServerScopedSessionRpcModuleMock } = await import('@/dev/testkit/mocks/serverScopedRpc');
    return installServerScopedSessionRpcModuleMock({ sessionRpcWithServerScope: boundary.rpc })(importOriginal);
});

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
    return createModalModuleMock({ spies: { alert: boundary.alert } }).module;
});

vi.mock('@/sync/sync', async () => {
    const { installSyncStub } = await import('@/dev/testkit/mocks/sync');
    return installSyncStub()();
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

/** Coordinator c1, and worker w1 whose last signal ("thinking") came at t0 and then nothing: its agent died. */
const script = loadDeskScript(raw);

async function openDetails(scenario: DeskScenario): Promise<void> {
    const button = scenario.screen.find((node) =>
        node.props?.accessibilityRole === 'button'
        && typeof node.props.onPress === 'function'
        && node.findAll((child) => child.children.includes('Details')).length > 0,
    );
    await pressTestInstanceAsync(button, 'Details');
}

describe('DeskScreen stale and disconnected workers (F1-F3)', () => {
    let scenario: DeskScenario | null = null;
    beforeEach(() => {
        boundary.rpc.mockReset().mockResolvedValue(undefined);
        boundary.alert.mockReset();
    });
    afterEach(async () => {
        await scenario?.dispose();
        scenario = null;
    });

    it('F1: just under the stale budget a thinking worker still counts as Working', async () => {
        scenario = await startDeskScenario({ script, coordinator: 'c1' });
        await scenario.advance(SESSION_RUNTIME_STATUS_STALE_SIGNAL_MS - 1_000);
        expect(scenario.textOf('ip-count-working')).toBe('1');
    });

    it('F1: past the stale budget a silent worker no longer counts as Working', async () => {
        scenario = await startDeskScenario({ script, coordinator: 'c1' });
        await scenario.advance(SESSION_RUNTIME_STATUS_STALE_SIGNAL_MS - 1_000);
        await scenario.advance(2_000);
        expect(scenario.textOf('ip-count-working')).toBe('0');
        expect(scenario.screen.findByTestId('ip-bulb-dot-working')).toBeNull();
    });

    it('F1: at exactly the stale budget the worker is no longer Working', async () => {
        scenario = await startDeskScenario({ script, coordinator: 'c1' });
        await scenario.advance(SESSION_RUNTIME_STATUS_STALE_SIGNAL_MS);
        expect(scenario.textOf('ip-count-working')).toBe('0');
    });

    it('F1: a new signal restarts the clock', async () => {
        scenario = await startDeskScenario({ script, coordinator: 'c1' });
        await scenario.advance(100_000);
        await scenario.apply('w1', { thinking: true });
        await scenario.advance(100_000);
        expect(scenario.textOf('ip-count-working')).toBe('1');
    });

    it('F1: a stale worker offers no Stop', async () => {
        scenario = await startDeskScenario({ script, coordinator: 'c1' });
        await openDetails(scenario);
        await scenario.advance(SESSION_RUNTIME_STATUS_STALE_SIGNAL_MS + 1_000);
        expect(scenario.screen.findByTestId('ip-stop-w1')).toBeNull();
    });

    it('F1: going stale writes nothing to the store', async () => {
        scenario = await startDeskScenario({ script, coordinator: 'c1' });
        const before = storage.getState().sessions.w1;
        await scenario.advance(SESSION_RUNTIME_STATUS_STALE_SIGNAL_MS + 1_000);
        // It did go stale, so the clock moved the count, not a write.
        expect(scenario.textOf('ip-count-working')).toBe('0');
        expect(storage.getState().sessions.w1).toBe(before);
    });

    it('F2: a silent online worker keeps Allow and Deny with a note, loses Stop, and recovers on a signal', async () => {
        scenario = await startDeskScenario({ script, coordinator: 'c1' });
        await scenario.apply('w1', { requests: { r1: { tool: 'Bash', arguments: { command: 'echo test' } } } });
        await openDetails(scenario);
        await scenario.openApprovals();
        await scenario.advance(SESSION_RUNTIME_STATUS_STALE_SIGNAL_MS - 1_000);
        expect(scenario.textOf('ip-worker-stale-w1')).toBeNull();
        expect(scenario.screen.findByTestId('ip-stop-w1')).not.toBeNull();
        await scenario.advance(1_000);
        expect(scenario.textOf('ip-worker-stale-w1')).toBe('Not heard from in 2 min');
        expect(scenario.screen.findByTestId('ip-stop-w1')).toBeNull();
        expect(scenario.textOf('ip-waiting-stale-r1')).toContain('worker may be gone');
        const allow = findTestInstanceByTypeContainingText(scenario.screen.tree, 'Pressable', 'Allow Bash')!;
        const deny = findTestInstanceByTypeContainingText(scenario.screen.tree, 'Pressable', 'Deny')!;
        expect(allow.props.disabled).not.toBe(true);
        expect(deny.props.disabled).not.toBe(true);
        await scenario.advance(10 * 60_000);
        expect(scenario.textOf('ip-worker-stale-w1')).toBe('Not heard from in 12 min');
        await pressTestInstanceAsync(allow);
        expect(boundary.rpc).toHaveBeenCalledWith(expect.objectContaining({ method: 'permission', payload: expect.objectContaining({ approved: true }) }));
        await scenario.apply('w1', { active: true, thinking: true });
        expect(scenario.textOf('ip-worker-stale-w1')).toBeNull();
        expect(scenario.textOf('ip-waiting-stale-r1')).toBeNull();
        expect(scenario.screen.findByTestId('ip-stop-w1')).not.toBeNull();
    });

    it('F3: disconnect preserves rows, freezes their age, blocks all three actions, and reconnect restores them', async () => {
        scenario = await startDeskScenario({ script, coordinator: 'c1' });
        await scenario.apply('w1', { requests: { r1: { tool: 'Bash', arguments: { command: 'echo test' } } } });
        await openDetails(scenario);
        await scenario.openApprovals();
        const lastGood = Date.now();
        act(() => {
            storage.getState().setLastSyncAt(lastGood - 60_000);
            storage.getState().setSocketStatus('disconnected');
        });
        const banner = scenario.screen.findByTestId('ip-connection-status');
        expect(banner?.props.role).toBe('status');
        expect(scenario.textOf('ip-connection-status')).toContain(new Date(lastGood).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }));
        const allow = findTestInstanceByTypeContainingText(scenario.screen.tree, 'Pressable', 'Allow Bash')!;
        const deny = findTestInstanceByTypeContainingText(scenario.screen.tree, 'Pressable', 'Deny')!;
        const stop = scenario.screen.findByTestId('ip-stop-w1')!;
        for (const button of [allow, deny, stop]) {
            expect(button.props.accessibilityState).toMatchObject({ disabled: true });
            // Invoke the handler too: visual disabling alone must not permit a send.
            await act(async () => { await button.props.onPress(); });
        }
        expect(boundary.rpc).not.toHaveBeenCalled();
        expect(scenario.textOf('ip-connection-status')).toContain('Reconnect to Allow, Deny or Stop.');
        await scenario.advance(12 * 60_000);
        expect(scenario.textOf('ip-count-all')).toBe('1');
        expect(scenario.screen.findByTestId('ip-stop-w1')).not.toBeNull();
        expect(scenario.textOf('ip-worker-stale-w1')).toBeNull();
        expect(scenario.textOf('ip-connection-status')).toContain(new Date(lastGood).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }));
        await scenario.apply('w1', { active: true, thinking: true });
        act(() => storage.getState().setSocketStatus('connected'));
        expect(scenario.screen.findByTestId('ip-connection-status')).toBeNull();
        await pressTestInstanceAsync(findTestInstanceByTypeContainingText(scenario.screen.tree, 'Pressable', 'Allow Bash'));
        expect(boundary.rpc).toHaveBeenCalledTimes(1);
    });

    it('M1: an error drop uses its disconnect stamp and includes yesterday’s date', async () => {
        scenario = await startDeskScenario({ script, coordinator: 'c1' });
        const droppedAt = Date.now();
        act(() => storage.getState().setSocketStatus('error'));
        expect(storage.getState().socketLastDisconnectedAt).toBe(droppedAt);
        await scenario.advance(24 * 60 * 60_000);
        act(() => storage.getState().setLastSyncAt(Date.now()));
        expect(scenario.textOf('ip-connection-status')).toContain(
            new Date(droppedAt).toLocaleString(undefined, {
                year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
            }),
        );
    });

    it('M1: failed reconnect attempts keep the first drop time; a later drop replaces it', async () => {
        scenario = await startDeskScenario({ script, coordinator: 'c1' });
        const hhmm = (ms: number) => new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
        const droppedAt = Date.now();
        act(() => storage.getState().setSocketStatus('error'));
        await scenario.advance(30 * 60_000);
        // Each failed retry (connect_error) restamps the store's disconnect time.
        act(() => {
            storage.getState().setSocketStatus('connecting');
            storage.getState().setSocketStatus('error');
        });
        const retriedAt = storage.getState().socketLastDisconnectedAt!;
        expect(hhmm(retriedAt)).not.toBe(hhmm(droppedAt));
        expect(scenario.textOf('ip-connection-status')).toContain(hhmm(droppedAt));
        expect(scenario.textOf('ip-connection-status')).not.toContain(hhmm(retriedAt));

        act(() => storage.getState().setSocketStatus('connected'));
        await scenario.advance(5 * 60_000);
        const secondDrop = Date.now();
        act(() => storage.getState().setSocketStatus('disconnected'));
        expect(scenario.textOf('ip-connection-status')).toContain(hhmm(secondDrop));
    });

    it('M1: uses the sync stamp when no disconnect stamp exists', async () => {
        scenario = await startDeskScenario({ script, coordinator: 'c1' });
        const syncedAt = Date.now() - 60_000;
        act(() => storage.setState({ socketStatus: 'connecting', socketLastDisconnectedAt: null, lastSyncAt: syncedAt }));
        expect(scenario.textOf('ip-connection-status')).toContain(
            new Date(syncedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }),
        );
    });

    it('M2: a disconnected rerender keeps fresh rows fresh while another clock consumer ticks', async () => {
        scenario = await startDeskScenario({ script, coordinator: 'c1' });
        await openDetails(scenario);
        // Another mounted app consumer can keep the shared bucket ticking after the desk unsubscribes.
        const unsubscribe = subscribeToNowMs(DESK_TICK_MS, () => {});
        try {
            act(() => storage.getState().setSocketStatus('disconnected'));
            await scenario.advance(SESSION_RUNTIME_STATUS_STALE_SIGNAL_MS + 60_000);
            // Metadata is not a worker signal, but forces the row/clock hook to render again.
            await scenario.apply('w1', { metadata: { name: 'Renamed worker' } });
            expect(scenario.textOf('ip-worker-stale-w1')).toBeNull();
            expect(scenario.screen.findByTestId('ip-stop-w1')).not.toBeNull();
            expect(scenario.textOf('ip-count-working')).toBe('1');
        } finally {
            unsubscribe();
        }
    });

    it('M3: an inactive worker with old signals stays resumable without a stale label', async () => {
        scenario = await startDeskScenario({ script, coordinator: 'c1' });
        await scenario.apply('w1', { active: false, thinking: false, metadata: { flavor: 'claude' } });
        await openDetails(scenario);
        await scenario.advance(10 * 60_000);
        act(() => storage.getState().applyMachines([createMachineFixture({
            id: 'desk-test-machine', active: true, activeAt: Date.now(),
        })]));
        expect(scenario.screen.findByTestId('ip-resume-w1')).not.toBeNull();
        expect(scenario.textOf('ip-worker-stale-w1')).toBeNull();
    });

    it('F3/F4: before any good data, disconnect does not invent a last-seen time', async () => {
        scenario = await startDeskScenario({ script: { ...script, sessions: [] }, dataReady: false });
        act(() => storage.setState({ socketStatus: 'error', socketLastDisconnectedAt: null, lastSyncAt: null }));
        expect(scenario.textOf('ip-connection-status')).toBe('Not connected. Waiting for the first update. Reconnect to Allow, Deny or Stop.');
        expect(scenario.textOf('ip-count-all')).toBe('–');
    });
});
