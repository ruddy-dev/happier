import * as React from 'react';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppPaneProvider } from '@/components/appShell/panes/AppPaneProvider';
import { renderScreen } from '@/dev/testkit';

import DeskFixturePage from '@/app/(app)/dev/desk-fixture';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

vi.mock('@/components/sessions/shell/SessionView', async () => {
    const { deskScreenMocks } = await import('@/ignorePrevious/testkit/deskScreenMocks');
    return deskScreenMocks.sessionView();
});

vi.mock('@/hooks/session/useHydrateSessionForRoute', async () => {
    const { deskScreenMocks } = await import('@/ignorePrevious/testkit/deskScreenMocks');
    return deskScreenMocks.hydrateSessionForRoute();
});

vi.mock('@/auth/context/AuthContext', () => ({
    useAuth: () => ({ isAuthenticated: false, credentials: null }),
}));

vi.mock('@/ignorePrevious/fixtures/applyDeskFixture', () => ({
    applyDeskFixture: () => {
        throw new Error('seeding failed');
    },
}));

class Boundary extends React.Component<{ children?: React.ReactNode }, { error: Error | null }> {
    state = { error: null as Error | null };
    static getDerivedStateFromError(error: Error) {
        return { error };
    }
    render() {
        return this.state.error ? React.createElement('Caught' as never, { message: this.state.error.message }) : this.props.children;
    }
}

describe('dev/desk-fixture route failure', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('shows an error, not a blank page, when seeding the fixture throws', async () => {
        vi.stubEnv('EXPO_PUBLIC_IP_FIXTURES', '1');
        const unhandled: unknown[] = [];
        const onUnhandled = (reason: unknown) => unhandled.push(reason);
        process.on('unhandledRejection', onUnhandled);
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

        const screen = await renderScreen(
            <Boundary>
                <AppPaneProvider>
                    <DeskFixturePage />
                </AppPaneProvider>
            </Boundary>,
        );
        await vi.waitFor(async () => {
            await act(async () => {});
            expect(screen.root.findAllByType('Caught' as never)).toHaveLength(1);
        });

        expect(screen.root.findByType('Caught' as never).props.message).toBe('seeding failed');
        expect(unhandled).toEqual([]);
        process.off('unhandledRejection', onUnhandled);
        consoleError.mockRestore();
        await screen.unmount();
    });
});
