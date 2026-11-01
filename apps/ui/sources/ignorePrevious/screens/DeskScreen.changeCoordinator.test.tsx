import * as React from 'react';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppPaneProvider } from '@/components/appShell/panes/AppPaneProvider';
import { renderScreen } from '@/dev/testkit';
import { createSessionFixture } from '@/dev/testkit/fixtures/sessionFixtures';
import { flushHookEffects } from '@/dev/testkit/hooks/flushHookEffects';
import { storage } from '@/sync/domains/state/storage';

import { getStoredCoordinatorId } from '../deskPrefs';
import { loadDeskScript, startDeskScenario, type DeskScenario } from '../testkit/deskScenario';

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


/** Two candidate coordinators and a worker, all busy; b is the newest. No issue tags. */
const script = loadDeskScript({
    id: 'change-coordinator',
    covers: ['change-coordinator'],
    sessions: [
        { id: 'a', title: 'Alpha session', path: '/w/atr-1-alpha', initial: { active: true, thinking: true } },
        { id: 'b', title: 'Bravo session', path: '/w/atr-2-bravo', initial: { active: true, thinking: true, updatedAt: 60_000 } },
        { id: 'w', title: 'Worker session', path: '/w/atr-3-worker', initial: { active: true, thinking: true } },
    ],
    steps: [],
});

type Screen = DeskScenario['screen'];

const picks = (screen: Screen) =>
    screen.tree.root.findAll((node) => typeof node.props?.testID === 'string' && node.props.testID.startsWith('ip-pick-') && typeof node.type === 'string');

describe('DeskScreen change coordinator', () => {
    let scenario: DeskScenario | null = null;
    let reloaded: Screen | null = null;
    afterEach(async () => {
        await reloaded?.unmount();
        reloaded = null;
        await scenario?.dispose();
        scenario = null;
    });

    /** A reload: the desk is gone and drawn again from the store and the stored pick. */
    async function reload(): Promise<Screen> {
        await scenario!.screen.unmount();
        function Panes({ children }: { children?: React.ReactNode }) {
            return <AppPaneProvider>{children}</AppPaneProvider>;
        }
        const { DeskScreen } = await import('./DeskScreen');
        reloaded = await renderScreen(<DeskScreen />, { wrapper: Panes });
        await flushHookEffects();
        return reloaded;
    }

    it('Change coordinator replaces a stored coordinator, and the old one becomes a worker', async () => {
        scenario = await startDeskScenario({ script, coordinator: 'a' });
        const { screen } = scenario;
        expect(screen.findByTestId('session-view-a')).toBeTruthy();
        expect(picks(screen)).toHaveLength(0);

        await screen.pressByTestIdAsync('ip-coordinator-change');
        expect(screen.findByTestId('session-view-a')).toBeFalsy();
        expect(screen.findByTestId('ip-pick-b')).toBeTruthy();

        await screen.pressByTestIdAsync('ip-pick-b');
        expect(screen.findByTestId('session-view-b')).toBeTruthy();
        expect(getStoredCoordinatorId()).toBe('b');
        expect(picks(screen)).toHaveLength(0);
        // a and w are workers now; b is out (L1).
        expect(scenario.textOf('ip-count-all')).toBe('2');
        expect(screen.findByTestId('ip-issue-ATR-1')).toBeTruthy();
        expect(screen.findByTestId('ip-issue-ATR-2')).toBeFalsy();
    });

    it('the change survives a reload', async () => {
        scenario = await startDeskScenario({ script, coordinator: 'a' });
        await scenario.screen.pressByTestIdAsync('ip-coordinator-change');
        await scenario.screen.pressByTestIdAsync('ip-pick-b');
        const screen2 = await reload();
        expect(screen2.findByTestId('session-view-b')).toBeTruthy();
        expect(picks(screen2)).toHaveLength(0);
    });

    it('each picker button is labelled with its session name', async () => {
        scenario = await startDeskScenario({ script });
        expect(scenario.screen.findByTestId('ip-pick-a')?.props.accessibilityLabel).toBe('Alpha session');
    });

    it('must not reopen the picker by itself when sessions update', async () => {
        scenario = await startDeskScenario({ script, coordinator: 'a' });
        act(() => {
            storage.getState().applySessions([createSessionFixture({ id: 'n', active: true, updatedAt: Date.now() + 1 })]);
        });
        await scenario.apply('b', { updatedAt: 120_000 });
        expect(picks(scenario.screen)).toHaveLength(0);
        expect(scenario.screen.findByTestId('session-view-a')).toBeTruthy();
    });

    it('must keep the current coordinator on Cancel', async () => {
        scenario = await startDeskScenario({ script, coordinator: 'a' });
        await scenario.screen.pressByTestIdAsync('ip-coordinator-change');
        await scenario.screen.pressByTestIdAsync('ip-coordinator-change-cancel');
        expect(scenario.screen.findByTestId('session-view-a')).toBeTruthy();
        expect(picks(scenario.screen)).toHaveLength(0);
        expect(getStoredCoordinatorId()).toBe('a');
    });

    it('must show the stored coordinator, not the picker, after a reload while choosing', async () => {
        scenario = await startDeskScenario({ script, coordinator: 'a' });
        await scenario.screen.pressByTestIdAsync('ip-coordinator-change');
        const screen2 = await reload();
        expect(screen2.findByTestId('session-view-a')).toBeTruthy();
        expect(picks(screen2)).toHaveLength(0);
    });

    it('must offer no change button and no Cancel when there is no coordinator', async () => {
        scenario = await startDeskScenario({ script });
        expect(picks(scenario.screen).length).toBeGreaterThan(0);
        expect(scenario.screen.findByTestId('ip-coordinator-change')).toBeFalsy();
        expect(scenario.screen.findByTestId('ip-coordinator-change-cancel')).toBeFalsy();
    });
});
