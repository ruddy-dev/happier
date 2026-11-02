import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadDeskScript, startDeskScenario, type DeskScenario } from '../testkit/deskScenario';
import raw from '../testkit/scripts/L1-coordinator-row.json';

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

/** Coordinator c1 and workers w1 and w2, all busy. The coordinator is the chat, not a worker. */
const script = loadDeskScript(raw);

describe('DeskScreen coordinator row (L1)', () => {
    let scenario: DeskScenario | null = null;
    afterEach(async () => {
        await scenario?.dispose();
        scenario = null;
    });

    it('L1: the Work panel counts only the workers', async () => {
        scenario = await startDeskScenario({ script, coordinator: 'c1' });
        expect(scenario.textOf('ip-count-all')).toBe('2');
    });

    it('L1: the coordinator gets no "No issue" card', async () => {
        scenario = await startDeskScenario({ script, coordinator: 'c1' });
        expect(scenario.screen.getTextContent()).not.toContain('No issue');
    });

    it('L1: a question from the coordinator is not counted as a worker waiting on you', async () => {
        scenario = await startDeskScenario({ script, coordinator: 'c1' });
        await scenario.apply('c1', { requests: { q1: { tool: 'Bash', arguments: { command: 'git push' } } } });
        expect(scenario.textOf('ip-count-turn')).toBe('0');
    });

    it('must not hide anyone when no coordinator is picked', async () => {
        scenario = await startDeskScenario({ script });
        expect(scenario.textOf('ip-count-all')).toBe('3');
    });

    it('L1: the coordinator\'s request still shows in what waits on you', async () => {
        scenario = await startDeskScenario({ script, coordinator: 'c1' });
        await scenario.apply('c1', { requests: { q1: { tool: 'Bash', arguments: { command: 'git push' } } } });
        expect(scenario.textOf('ip-approvals-count')).toBe('1');
    });
});

// These scenarios exercise the concurrent desktop panes. Phone navigation has its own tests.
vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock({ useWindowDimensions: () => ({ width: 1440, height: 900, scale: 1, fontScale: 1 }) });
});
