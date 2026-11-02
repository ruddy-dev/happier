import * as React from 'react';
import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NativeStackHeaderProps, NativeStackNavigationOptions } from '@react-navigation/native-stack';
import { Platform, StyleSheet, type PressableProps } from 'react-native';
import { renderScreen } from '@/dev/testkit/render/renderScreen';
import { DESK_FONT_STACK } from '../fonts/deskFont';
import { DeskPageScope } from './DeskPageScope';

const route = vi.hoisted(() => ({ pathname: '/', dark: false, capture: null as import('@/dev/testkit/mocks/router').StackOptionsCapture | null }));
vi.mock('expo-router', async () => {
    const { createExpoRouterMock, createStackOptionsCapture } = await import('@/dev/testkit/mocks/router');
    route.capture = createStackOptionsCapture();
    return createExpoRouterMock({ pathname: () => route.pathname, stackOptionsCapture: route.capture }).module;
});
vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock({
        Pressable: ({ children, style, ...props }: PressableProps) => React.createElement('Pressable', {
            ...props, style: typeof style === 'function' ? style({ pressed: false }) : style,
        }, typeof children === 'function' ? children({ pressed: false }) : children),
    });
});
vi.mock('@react-navigation/native', async () => {
    const { createReactNavigationNativeMock } = await import('@/dev/testkit/mocks/reactNavigation');
    return createReactNavigationNativeMock();
});
vi.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
    useSafeAreaFrame: () => ({ x: 0, y: 0, width: 1200, height: 900 }),
    SafeAreaView: ({ children }: React.PropsWithChildren) => <>{children}</>,
}));
// Radix is the external browser dialog boundary.
vi.mock('@/utils/web/radixCjs', () => {
    const Pass = ({ children }: React.PropsWithChildren) => <>{children}</>;
    return {
        requireRadixDialog: () => ({ Root: Pass, Portal: Pass, Overlay: Pass, Content: Pass, Title: Pass }),
        requireRadixDismissableLayer: () => ({ Branch: Pass }),
    };
});
// Keep the real profile resolver and page logic; model only the Unistyles named scope.
vi.mock('react-native-unistyles', async () => {
    const React = await import('react');
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    const { lightTheme, darkTheme } = await import('@/theme');
    const { resolveThemeProfile } = await import('@/theme/profiles/resolveThemeProfile');
    const { ignorePreviousProfile, ignorePreviousLightProfile } = await import('@/theme/profiles/ignorePreviousThemeProfile');
    const themes = {
        deskPageLight: resolveThemeProfile({ mode: 'light', profile: ignorePreviousLightProfile }),
        deskPageDark: resolveThemeProfile({ mode: 'dark', profile: ignorePreviousProfile }),
    };
    const Scope = React.createContext<keyof typeof themes | null>(null);
    const base = await createUnistylesMock();
    return {
        ...base,
        ScopedTheme: ({ name, children }: { name: keyof typeof themes; children: React.ReactNode }) => (
            <Scope.Provider value={name}>{children}</Scope.Provider>
        ),
        useUnistyles: () => {
            const name = React.useContext(Scope);
            return { ...base.useUnistyles(), theme: name ? themes[name] : route.dark ? darkTheme : lightTheme };
        },
    };
});
// The sync singleton opens sockets and native transports at import time.
vi.mock('@/sync/sync', async () => {
    const { createSyncModuleStub } = await import('@/dev/testkit/mocks/sync');
    const stub = createSyncModuleStub();
    return { ...stub, sync: { ...stub.sync, refreshMachinesThrottled: vi.fn(async () => {}) }, syncSwitchServer: vi.fn(async () => {}) };
});

import { AuthProvider } from '@/auth/context/AuthContext';
import { createWelcomeFeaturesResponse } from '@/__tests__/routes/(app)/index.testHelpers';

const previousPlatform = Platform.OS;
beforeEach(async () => {
    // Metro resolves this lazy asset-registry require. Route it to the real Vite-loaded module.
    const registry = await import('@/agents/registry/registryUi');
    // Node's CJS loader is untyped; bridge only Metro's lazy alias to the real module.
    const loader = createRequire(import.meta.url)('node:module') as { _load: (...args: unknown[]) => unknown };
    const originalLoad = loader._load;
    vi.spyOn(loader, '_load').mockImplementation((...args) => (
        args[0] === '@/agents/registry/registryUi' ? registry : originalLoad(...args)
    ));
    Platform.OS = 'web';
    route.capture?.reset();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(createWelcomeFeaturesResponse()), {
        status: 200, headers: { 'content-type': 'application/json' },
    })));
});
afterEach(() => {
    Platform.OS = previousPlatform;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

const pages = [
    { path: '/', load: () => import('@/app/(app)/index') },
    { path: '/restore/manual', load: () => import('@/app/(app)/restore/manual') },
    { path: '/settings/voice', load: () => import('@/app/(app)/settings/voice') },
];

describe.each([false, true])('desk page appearance, dark=%s', (dark) => {
    it.each(pages)('$path renders desk typography and theme', async ({ path, load }) => {
        route.pathname = path;
        route.dark = dark;
        const Page = (await load()).default;
        const screen = await renderScreen(<AuthProvider initialCredentials={null}><Page /></AuthProvider>);
        const texts = screen.findAll((node) => String(node.type) === 'Text' || String(node.type) === 'TextInput');
        expect(texts.length).toBeGreaterThan(0);
        expect.soft(new Set(texts.map((node) => StyleSheet.flatten(node.props.style)?.fontFamily))).toEqual(new Set([DESK_FONT_STACK]));
        const backgrounds = screen.findAll((node) => typeof node.type === 'string')
            .map((node) => StyleSheet.flatten(node.props.style)?.backgroundColor);
        expect.soft(backgrounds).toContain(dark ? '#0b0b0e' : '#e9e3d0');
        // Sign-in shares a route with authenticated Home. Expo retains setOptions after
        // Screen unmount, so sign-in must never replace that route's stack appearance.
        if (path === '/') {
            expect.soft(route.capture?.getResolved()).toBeNull();
        } else {
            expect.soft(route.capture?.getResolved()).toMatchObject({
                headerStyle: { backgroundColor: dark ? '#14161c' : '#f6f1e3' },
                headerTintColor: dark ? '#f3ecd8' : '#14161c',
                headerTitleStyle: { fontFamily: DESK_FONT_STACK },
            });
        }
        if (path !== '/') {
            const options = route.capture?.getResolved() as NativeStackNavigationOptions;
            const renderHeader = options.header!;
            const titleText = path === '/settings/voice' ? 'Voice' : 'Restore';
            // Navigation is the external boundary; no back action is requested in this fixture.
            const navigation = {} as NativeStackHeaderProps['navigation'];
            // NativeStackView calls this as a plain function, outside the header's render.
            // The Unistyles boundary uses a real useContext, so calling a hook here throws.
            const element = renderHeader({ options: { ...options, title: titleText }, route: { key: path, name: path }, navigation });
            expect(React.isValidElement(element)).toBe(true);
            if (!React.isValidElement(element)) throw new Error('Expected a header element');
            const header = await renderScreen(element);
            const scope = header.findByType(DeskPageScope);
            expect(scope.props.name).toBe(dark ? 'deskPageDark' : 'deskPageLight');
            const title = scope.findAll((node) => String(node.type) === 'Text').find((node) => node.children.includes(titleText));
            expect(StyleSheet.flatten(title?.props.style)).toMatchObject({
                fontFamily: DESK_FONT_STACK, color: dark ? '#f3ecd8' : '#14161c',
            });
        }
        if (path === '/restore/manual') {
            expect(screen.findHostByTestId('restore-manual-secret-input')?.props.placeholderTextColor)
                .toBe(dark ? '#8a857a' : '#625d52');
        }
    });
});

// Render an actual excluded route after Voice in the same root to catch scope leakage.
it.each([
    { path: '/settings', load: () => import('@/app/(app)/settings/index') },
    { path: '/session/recent', load: () => import('@/app/(app)/session/recent') },
])('$path retains Happier typography after leaving Voice', async ({ path, load }) => {
    route.pathname = '/settings/voice';
    route.dark = false;
    const Voice = (await import('@/app/(app)/settings/voice')).default;
    const screen = await renderScreen(<AuthProvider initialCredentials={null}><Voice /></AuthProvider>);
    route.pathname = path;
    const Page = (await load()).default;
    await screen.update(<AuthProvider initialCredentials={null}><Page /></AuthProvider>);
    const texts = screen.findAll((node) => String(node.type) === 'Text');
    expect(texts.length).toBeGreaterThan(0);
    const families = texts.map((node) => StyleSheet.flatten(node.props.style)?.fontFamily);
    expect(families).toContain('Inter-Regular');
    expect(families).not.toContain(DESK_FONT_STACK);
    const backgrounds = screen.findAll((node) => typeof node.type === 'string')
        .map((node) => StyleSheet.flatten(node.props.style)?.backgroundColor);
    expect(backgrounds).toContain('#F5F5F5');
    expect(backgrounds).not.toContain('#e9e3d0');
});

it('styles a real restore validation dialog rendered by the app modal host', async () => {
    route.pathname = '/restore/manual';
    route.dark = true;
    const { AppPaneModalProvider } = await import('@/components/appShell/providers/AppPaneModalProvider');
    const { Modal } = await import('@/modal');
    const Restore = (await import('@/app/(app)/restore/manual')).default;
    const screen = await renderScreen(<AuthProvider initialCredentials={null}>
        <AppPaneModalProvider><Restore /></AppPaneModalProvider>
    </AuthProvider>);
    try {
        await screen.pressByTestIdAsync('restore-manual-submit');
        const { WebAlertModal } = await import('@/modal/components/WebAlertModal');
        const dialog = screen.findByType(WebAlertModal);
        const texts = dialog.findAll((node) => String(node.type) === 'Text');
        expect(texts.length).toBeGreaterThan(0);
        expect(new Set(texts.map((node) => StyleSheet.flatten(node.props.style)?.fontFamily)))
            .toEqual(new Set([DESK_FONT_STACK]));
    } finally {
        await React.act(async () => Modal.hideAll());
    }
});

it.each([
    { path: '/settings', credentials: null },
    { path: '/', credentials: { token: 'fixture-token', secret: 'fixture-secret' } },
])('keeps Happier typography in excluded modal hosts: $path', async ({ path, credentials }) => {
    route.pathname = path;
    const { AppPaneModalProvider } = await import('@/components/appShell/providers/AppPaneModalProvider');
    const { Modal } = await import('@/modal');
    const screen = await renderScreen(<AuthProvider initialCredentials={credentials}>
        <AppPaneModalProvider><></></AppPaneModalProvider>
    </AuthProvider>);
    try {
        await React.act(async () => { Modal.alert('Fixture', 'Message'); });
        const texts = screen.findAll((node) => String(node.type) === 'Text');
        expect(texts.length).toBeGreaterThan(0);
        expect(texts.map((node) => StyleSheet.flatten(node.props.style)?.fontFamily)).not.toContain(DESK_FONT_STACK);
    } finally {
        await React.act(async () => Modal.hideAll());
    }
});

it('preserves a retained restore form and its scope when the current path leaves and returns', async () => {
    route.pathname = '/restore/manual';
    route.dark = false;
    const Restore = (await import('@/app/(app)/restore/manual')).default;
    const screen = await renderScreen(<AuthProvider initialCredentials={null}><Restore /></AuthProvider>);
    await React.act(async () => {
        screen.findHostByTestId('restore-manual-secret-input')!.props.onChangeText('fixture-key');
    });
    for (const path of ['/restore', '/', '/restore/manual']) {
        route.pathname = path;
        await screen.update(<AuthProvider initialCredentials={null}><Restore /></AuthProvider>);
        const input = screen.findHostByTestId('restore-manual-secret-input')!;
        expect.soft(input.props.value).toBe('fixture-key');
        expect.soft(StyleSheet.flatten(input.props.style)?.fontFamily).toBe(DESK_FONT_STACK);
    }
});

it('preserves an open Voice prompt across navigation away and back', async () => {
    route.pathname = '/settings/voice';
    route.dark = false;
    const { AppPaneModalProvider } = await import('@/components/appShell/providers/AppPaneModalProvider');
    const { Modal } = await import('@/modal');
    const Voice = (await import('@/app/(app)/settings/voice')).default;
    const { t } = await import('@/text');
    const screen = await renderScreen(<AuthProvider initialCredentials={null}>
        <AppPaneModalProvider><Voice /></AppPaneModalProvider>
    </AuthProvider>);
    try {
        const countItem = screen.findAll((node) => node.props.title === t('settingsVoice.privacy.recentMessagesCount') && typeof node.props.onPress === 'function')[0];
        await React.act(async () => { countItem.props.onPress(); });
        await React.act(async () => { screen.findHostByTestId('web-prompt-input')!.props.onChangeText('23'); });
        for (const path of ['/settings', '/settings/voice']) {
            route.pathname = path;
            await screen.update(<AuthProvider initialCredentials={null}>
                <AppPaneModalProvider><Voice /></AppPaneModalProvider>
            </AuthProvider>);
            const input = screen.findHostByTestId('web-prompt-input')!;
            expect.soft(input.props.value).toBe('23');
            expect.soft(StyleSheet.flatten(input.props.style)?.fontFamily).toBe(DESK_FONT_STACK);
        }
    } finally {
        await React.act(async () => Modal.hideAll());
    }
});

it('keeps each overlapping dialog in the appearance where it opened', async () => {
    route.pathname = '/settings';
    route.dark = false;
    const { AppPaneModalProvider } = await import('@/components/appShell/providers/AppPaneModalProvider');
    const { Modal } = await import('@/modal');
    const { WebPromptModal } = await import('@/modal/components/WebPromptModal');
    const screen = await renderScreen(<AuthProvider initialCredentials={null}>
        <AppPaneModalProvider><></></AppPaneModalProvider>
    </AuthProvider>);
    try {
        await React.act(async () => { void Modal.prompt('Ordinary', 'Message'); });
        await React.act(async () => { screen.findHostByTestId('web-prompt-input')!.props.onChangeText('ordinary draft'); });
        route.pathname = '/settings/voice';
        await screen.update(<AuthProvider initialCredentials={null}>
            <AppPaneModalProvider><></></AppPaneModalProvider>
        </AuthProvider>);
        const ordinary = screen.findHostByTestId('web-prompt-input')!;
        expect.soft(ordinary.props.value).toBe('ordinary draft');
        expect.soft(StyleSheet.flatten(ordinary.props.style)?.fontFamily).not.toBe(DESK_FONT_STACK);
        await React.act(async () => { void Modal.prompt('Desk', 'Message'); });
        const dialogs = screen.findAllByType(WebPromptModal);
        expect(dialogs).toHaveLength(2);
        const inputs = dialogs.map((dialog) => dialog.findAll((node) => typeof node.type === 'string' && node.props.testID === 'web-prompt-input')[0]);
        expect.soft(inputs[0].props.value).toBe('ordinary draft');
        expect.soft(StyleSheet.flatten(inputs[0].props.style)?.fontFamily).not.toBe(DESK_FONT_STACK);
        expect.soft(StyleSheet.flatten(inputs[1].props.style)?.fontFamily).toBe(DESK_FONT_STACK);
        await React.act(async () => Modal.hideAll());
        route.pathname = '/settings';
        await screen.update(<AuthProvider initialCredentials={null}>
            <AppPaneModalProvider><></></AppPaneModalProvider>
        </AuthProvider>);
        await React.act(async () => { void Modal.prompt('New ordinary', 'Message'); });
        expect(StyleSheet.flatten(screen.findHostByTestId('web-prompt-input')!.props.style)?.fontFamily).not.toBe(DESK_FONT_STACK);
    } finally {
        await React.act(async () => Modal.hideAll());
    }
});
