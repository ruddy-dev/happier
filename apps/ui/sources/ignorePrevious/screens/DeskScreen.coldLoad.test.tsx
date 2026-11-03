import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadDeskScript, startDeskScenario, type DeskScenario } from '../testkit/deskScenario';
import { revealWaitingDetails } from '../testkit/revealWaitingDetails';
import raw from '../testkit/scripts/F4-cold-load.json';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

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
    return createModalModuleMock().module;
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

/** A coordinator and a worker with one command waiting, before the app's first sync has finished. */
const script = loadDeskScript(raw);

describe('DeskScreen cold load (F4)', () => {
    let scenario: DeskScenario | null = null;
    afterEach(async () => {
        await scenario?.dispose();
        scenario = null;
    });

    it('F4: before the first sync, "Nothing waits on you." is not shown', async () => {
        scenario = await startDeskScenario({ script, coordinator: 'c1', dataReady: false });
        await scenario.openApprovals();
        // Before the first sync the desk doesn't know yet; saying nothing waits would be false here.
        expect(scenario.screen.getTextContent()).not.toContain('Nothing waits on you.');
    });

    it('F4: the coordinator picker is not offered before ready', async () => {
        scenario = await startDeskScenario({ script, dataReady: false });
        expect(scenario.screen.getTextContent()).not.toContain('Pick the coordinator session');
    });

    it('F4: after ready() the waiting count and rows appear', async () => {
        scenario = await startDeskScenario({ script, coordinator: 'c1', dataReady: false });
        await scenario.openApprovals();
        await scenario.ready();
        expect(scenario.textOf('ip-approvals-count')).toBe('1 request');
        expect(scenario.screen.findByTestId('ip-waiting')).toBeTruthy();
        await revealWaitingDetails(scenario.screen);
        expect(scenario.textOf('ip-waiting')).toContain('Fix the login form');
    });

    it('F4: before the first sync the Work counts show a dash, not 0', async () => {
        scenario = await startDeskScenario({ script, coordinator: 'c1', dataReady: false });
        expect(scenario.textOf('ip-count-all')).toBe('–');
        expect(scenario.textOf('ip-count-turn')).toBe('–');
    });

    it('F4: before the first sync Waiting says Connecting…', async () => {
        scenario = await startDeskScenario({ script, coordinator: 'c1', dataReady: false });
        await scenario.openApprovals();
        expect(scenario.textOf('ip-waiting-connecting')).toBe('Connecting…');
        expect(scenario.screen.findByTestId('ip-waiting-empty')).toBeFalsy();
    });

    it('A2: before the first sync the approvals badge shows no count and its label does not say 0', async () => {
        scenario = await startDeskScenario({ script, coordinator: 'c1', dataReady: false });
        const badge = () => scenario!.screen.findByTestId('ip-approvals-open');
        expect(scenario.textOf('ip-approvals-count')).toBe('– requests');
        expect(badge()?.props.accessibilityLabel).not.toMatch(/\b0\b/);
        expect(badge()?.props.accessibilityLabel).toContain('connecting');

        // After the first sync it counts again, as before.
        await scenario.ready();
        expect(scenario.textOf('ip-approvals-count')).toBe('1 request');
        expect(badge()?.props.accessibilityLabel).toBe('Show what waits on you, 1 request');
    });

    it('F4: after ready() the Work counts are numbers again and Connecting… is gone', async () => {
        scenario = await startDeskScenario({ script, coordinator: 'c1', dataReady: false });
        await scenario.openApprovals();
        await scenario.ready();
        expect(scenario.textOf('ip-count-all')).not.toBe('–');
        expect(scenario.screen.findByTestId('ip-waiting-connecting')).toBeFalsy();
    });
});

// These scenarios exercise the concurrent desktop panes. Phone navigation has its own tests.
vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock({ useWindowDimensions: () => ({ width: 1440, height: 900, scale: 1, fontScale: 1 }) });
});
