import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppPaneProvider } from '@/components/appShell/panes/AppPaneProvider';
import { renderScreen, standardCleanup } from '@/dev/testkit';
import { readReactNativeMmkvStubEntries } from '@/dev/testkit/mocks/mmkv';
import { storage } from '@/sync/domains/state/storage';
import { setCoordinatorOverride } from '../deskPrefs';

const state = vi.hoisted(() => ({
    pathname: '/desk/settings',
    width: 1440,
    dark: true,
    navigate: vi.fn(),
}));

vi.mock('expo-router', async () => {
    const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
    return createExpoRouterMock({ pathname: () => state.pathname, router: { navigate: state.navigate } }).module;
});
vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock({ useWindowDimensions: () => ({ width: state.width, height: 800, scale: 1, fontScale: 1 }) });
});
vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    const boundary = await createUnistylesMock();
    return {
        ...boundary,
        useUnistyles: () => {
            const { theme, rt } = boundary.useUnistyles();
            return { theme: { ...theme, dark: state.dark }, rt };
        },
    };
});
vi.mock('@expo/vector-icons', async () => {
    const { createExpoVectorIconsMock } = await import('@/dev/testkit/mocks/icons');
    return createExpoVectorIconsMock();
});
vi.mock('@react-navigation/native', async () => {
    const { createReactNavigationNativeMock } = await import('@/dev/testkit/mocks/reactNavigation');
    return createReactNavigationNativeMock();
});

function Panes({ children }: React.PropsWithChildren) {
    return <AppPaneProvider>{children}</AppPaneProvider>;
}

async function settingsPage() {
    const { default: SettingsPage } = await import('@/app/(app)/desk/settings');
    return <SettingsPage />;
}

describe('/desk/settings', () => {
    let previous: ReturnType<typeof storage.getState>;
    beforeEach(() => {
        previous = storage.getState();
        state.pathname = '/desk/settings';
        state.width = 1440;
        state.dark = true;
        state.navigate.mockClear();
    });
    afterEach(() => {
        standardCleanup();
        setCoordinatorOverride(null);
        act(() => storage.setState(previous, true));
    });

    it('shows the About credit and fork notice, and Back navigates directly to /desk', async () => {
        const screen = await renderScreen(await settingsPage());
        expect(screen.getTextContent()).toContain('by Ignore Previous');
        expect(screen.getTextContent()).toContain('A fork of Happier');
        expect(screen.findAllByProps({ 'data-ip-font': 'desk' })).toHaveLength(1);
        await screen.pressByTestIdAsync('ip-settings-back');
        expect(state.navigate).toHaveBeenCalledWith('/desk');
    });

    it('does not materialize defaults in storage on mount or remount', async () => {
        const screen = await renderScreen(await settingsPage());
        expect(readReactNativeMmkvStubEntries()).toEqual([]);
        await screen.unmount();
        await renderScreen(await settingsPage());
        expect(readReactNativeMmkvStubEntries()).toEqual([]);
    });

    it('J12: a settings choice survives desk layout/theme changes and a settings remount', async () => {
        const screen = await renderScreen(await settingsPage(), { wrapper: Panes });
        expect(screen.findByTestId('ip-settings-creature')?.props.accessibilityState).toEqual({ checked: true });
        await screen.pressByTestIdAsync('ip-settings-creature');
        expect(screen.findByTestId('ip-settings-creature')?.props.accessibilityState).toEqual({ checked: false });

        const { default: DeskPage } = await import('@/app/(app)/desk');
        state.pathname = '/desk';
        await screen.update(<DeskPage />);
        await screen.pressByTestIdAsync('ip-settings-open');
        expect(state.navigate).toHaveBeenCalledWith('/desk/settings');
        await screen.pressByTestIdAsync('ip-work-collapse');
        expect(screen.findByTestId('ip-work-rail')).not.toBeNull();
        state.width = 390;
        state.dark = false;
        await screen.update(<DeskPage />);
        await screen.pressByTestIdAsync('ip-tab-work');
        expect(screen.findByTestId('ip-work-rail')).not.toBeNull();
        await screen.pressByTestIdAsync('ip-work-expand');
        expect(screen.findByTestId('ip-work')).not.toBeNull();
        await screen.unmount();

        state.pathname = '/desk/settings';
        const remounted = await renderScreen(await settingsPage());
        expect(remounted.findByTestId('ip-settings-creature')?.props.accessibilityState).toEqual({ checked: false });
    });
});
