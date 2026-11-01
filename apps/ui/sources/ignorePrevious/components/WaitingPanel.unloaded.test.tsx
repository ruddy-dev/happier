import { afterEach, describe, expect, it, vi } from 'vitest';

import { findTestInstanceByTypeContainingText } from '@/dev/testkit/render/renderScreen';

import { loadDeskScript, startDeskScenario, type DeskScenario } from '../testkit/deskScenario';
import raw from '../testkit/scripts/W6-unloaded-record.json';

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

/**
 * Worker w1 reports a request waiting, but only its list row has loaded, not the record that holds
 * the request. At 5 s the record arrives.
 */
const script = loadDeskScript(raw);

describe('WaitingPanel unloaded record (W6)', () => {
    let scenario: DeskScenario | null = null;
    afterEach(async () => {
        await scenario?.dispose();
        scenario = null;
    });

    it('W6: unloaded row says what it can and offers no answer', async () => {
        scenario = await startDeskScenario({ script, coordinator: 'c1' });
        await scenario.openApprovals();
        const waiting = scenario.textOf('ip-waiting') ?? '';
        expect(waiting).toContain('Fix the login form');
        expect(waiting).toContain('Waiting on you. Open the session to see what.');
        expect(findTestInstanceByTypeContainingText(scenario.screen.tree, 'Pressable', 'Open session')).toBeTruthy();
        expect(waiting).not.toContain('Allow');
        expect(waiting).not.toContain('Deny');
        expect(scenario.textOf('ip-approvals-count')).toBe('1');
    });

    it('W6: when the record loads, the row becomes an Allow card', async () => {
        scenario = await startDeskScenario({ script, coordinator: 'c1' });
        await scenario.openApprovals();
        await scenario.advance(5_000);
        const waiting = scenario.textOf('ip-waiting') ?? '';
        expect(waiting).toContain('Allow Bash');
        expect(waiting).not.toContain('Waiting on you. Open the session to see what.');
        expect(scenario.textOf('ip-approvals-count')).toBe('1');
    });
});
