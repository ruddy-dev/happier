import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadDeskScript, startDeskScenario, type DeskScenario } from '../testkit/deskScenario';
import raw from '../testkit/scripts/F4-cold-load.json';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@expo/vector-icons', async () => {
    const { createExpoVectorIconsMock } = await import('@/dev/testkit/mocks/icons');
    return createExpoVectorIconsMock();
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

    // Fails today: the panel renders its empty state before the first sync. ATR-24 (P0.3) fixes it and flips this.
    it.fails('F4: before the first sync, "Nothing waits on you." is not shown', async () => {
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
        expect(scenario.textOf('ip-approvals-count')).toBe('1');
        expect(scenario.screen.findByTestId('ip-waiting')).toBeTruthy();
        expect(scenario.textOf('ip-waiting')).toContain('Fix the login form');
    });

    // The loading design for the Work tiles is undecided; ATR-24 (P0.3 Task 8) replaces this.
    it.todo('F4 Q? work tiles while loading');
});
