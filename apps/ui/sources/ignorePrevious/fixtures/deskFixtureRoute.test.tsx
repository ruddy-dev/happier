import * as React from 'react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppPaneProvider } from '@/components/appShell/panes/AppPaneProvider';
import { renderScreen } from '@/dev/testkit';
import { storage } from '@/sync/domains/state/storage';

import { getStoredCoordinatorId, setStoredCoordinatorId } from '@/ignorePrevious/deskPrefs';

import DeskFixturePage from '@/app/(app)/dev/desk-fixture';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@expo/vector-icons', async () => {
    const { createExpoVectorIconsMock } = await import('@/dev/testkit/mocks/icons');
    return createExpoVectorIconsMock();
});

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

// The whole chat surface is Happier's; the fixture replaces the coordinator body with a stub, and the
// test proves the real one is not mounted.
vi.mock('@/components/sessions/shell/SessionView', async () => {
    const { deskScreenMocks } = await import('@/ignorePrevious/testkit/deskScreenMocks');
    return deskScreenMocks.sessionView();
});

vi.mock('@/hooks/session/useHydrateSessionForRoute', async () => {
    const { deskScreenMocks } = await import('@/ignorePrevious/testkit/deskScreenMocks');
    return deskScreenMocks.hydrateSessionForRoute();
});

function Panes({ children }: { children?: React.ReactNode }) {
    return <AppPaneProvider>{children}</AppPaneProvider>;
}

describe('dev/desk-fixture route', () => {
    const before = storage.getState();
    const storedBefore = getStoredCoordinatorId();

    beforeEach(() => {
        storage.setState(before, true);
        setStoredCoordinatorId(null);
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        storage.setState(before, true);
        setStoredCoordinatorId(storedBefore);
    });

    it('redirects home and seeds nothing when the build has no fixture flag', async () => {
        vi.stubEnv('EXPO_PUBLIC_IP_FIXTURES', '');

        const screen = await renderScreen(<DeskFixturePage />, { wrapper: Panes });

        expect(screen.root.findAllByType('Redirect' as never).map((node) => node.props.href)).toEqual(['/']);
        expect(screen.findByTestId('ip-work')).toBeNull();
        expect(Object.keys(storage.getState().sessions)).toHaveLength(0);
        expect(getStoredCoordinatorId()).toBeNull();
        await screen.unmount();
    });

    it('treats any value but 1 as off', async () => {
        vi.stubEnv('EXPO_PUBLIC_IP_FIXTURES', '0');

        const screen = await renderScreen(<DeskFixturePage />, { wrapper: Panes });

        expect(screen.root.findAllByType('Redirect' as never)).toHaveLength(1);
        expect(Object.keys(storage.getState().sessions)).toHaveLength(0);
        await screen.unmount();
    });

    it('shows the whole seeded desk, coordinator included, when the flag is on', async () => {
        vi.stubEnv('EXPO_PUBLIC_IP_FIXTURES', '1');

        const screen = await renderScreen(<DeskFixturePage />, { wrapper: Panes });

        // The fixture module is loaded by a dynamic import, so the desk appears once the store is seeded.
        await vi.waitFor(async () => {
            await act(async () => {});
            expect(screen.findByTestId('ip-fixture-coordinator-body')).not.toBeNull();
        });
        expect(screen.root.findAllByType('Redirect' as never)).toHaveLength(0);
        expect(screen.findByTestId('ip-work')).not.toBeNull();
        expect(screen.findByTestId('session-view-fx-coord')).toBeNull();
        expect(storage.getState().isDataReady).toBe(true);
        expect(getStoredCoordinatorId()).toBe('fx-coord');
        await screen.unmount();
    });
});
