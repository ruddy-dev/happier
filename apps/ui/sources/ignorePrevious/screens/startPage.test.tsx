import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Home from '@/app/(app)/index';
import DeskPage from '@/app/(app)/desk';
import { AuthProvider } from '@/auth/context/AuthContext';
import { MainView } from '@/components/navigation/shell/MainView';
import { RootLayoutRedirectGate } from '@/components/navigation/root/RootLayoutRedirectGate';
import { AppPaneProvider } from '@/components/appShell/panes/AppPaneProvider';
import { renderScreen } from '@/dev/testkit';
import { storage } from '@/sync/domains/state/storage';
import { upsertAndActivateServer } from '@/sync/domains/server/serverRuntime';
import { setPendingTerminalConnect, getPendingTerminalConnect, clearPendingTerminalConnect } from '@/sync/domains/pending/pendingTerminalConnect';
import { createWelcomeFeaturesResponse } from '@/__tests__/routes/(app)/index.testHelpers';

const navigation = vi.hoisted(() => ({
    pathname: '/',
    platformOS: 'web',
    params: {} as Record<string, string | string[] | undefined>,
    replace: vi.fn(),
}));

vi.mock('expo-router', async () => {
    const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
    return createExpoRouterMock({
        pathname: () => navigation.pathname,
        params: () => navigation.params,
        segments: () => ['(app)', ...navigation.pathname.split('/').filter(Boolean)],
        router: { replace: navigation.replace },
    }).module;
});

vi.mock('@react-navigation/native', async () => {
    const { createReactNavigationNativeMock } = await import('@/dev/testkit/mocks/reactNavigation');
    return createReactNavigationNativeMock();
});

vi.mock('@expo/vector-icons', async () => {
    const { createExpoVectorIconsMock } = await import('@/dev/testkit/mocks/icons');
    return createExpoVectorIconsMock();
});

vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock();
});

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock({
        Platform: { get OS() { return navigation.platformOS; } },
        useWindowDimensions: () => ({ width: 390, height: 844, scale: 1, fontScale: 1 }),
    });
});

// Native drawing and inset boundaries are unavailable in the host renderer.
vi.mock('@shopify/react-native-skia', () => ({}));
vi.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const credentials = { token: `hdr.${Buffer.from(JSON.stringify({ sub: 'start-page-test' })).toString('base64')}.sig` };

function atPath(pathname: string, search = '') {
    navigation.pathname = pathname;
    // The existing root-link guard reads the browser URL, independently of Expo params.
    vi.stubGlobal('window', { location: { pathname, search } });
}

async function show(children: React.ReactNode, signedIn = true) {
    return renderScreen(
        <AuthProvider initialCredentials={signedIn ? credentials : null}>
            <AppPaneProvider>
                <RootLayoutRedirectGate>{children}</RootLayoutRedirectGate>
            </AppPaneProvider>
        </AuthProvider>,
    );
}

describe('signed-in start page', () => {
    const initialStore = storage.getState();

    beforeEach(() => {
        navigation.platformOS = 'web';
        navigation.params = {};
        navigation.replace.mockClear();
        storage.setState(initialStore, true);
        // A returning signed-out visitor goes straight to the sign-in choices.
        storage.getState().applyLocalSettings({ brandHeroSeenAt: 1 });
        upsertAndActivateServer({ serverUrl: 'http://localhost:53289', scope: 'device' });
        clearPendingTerminalConnect();
        atPath('/');
        vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
            const url = String(input);
            if (url.endsWith('/v1/features')) return Response.json(createWelcomeFeaturesResponse());
            if (url.endsWith('/v1/kv/bulk')) return Response.json({ values: [] });
            return new Response(null, { status: 404 });
        }));
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        storage.setState(initialStore, true);
    });

    it('redirects signed-in / to /desk without mounting the old home', async () => {
        const screen = await show(<Home />);
        expect(screen.findAllByType('Redirect').map((node) => node.props.href)).toEqual(['/desk']);
        expect(screen.findAllByType(MainView)).toHaveLength(0);
        await screen.unmount();
    });

    it.each<Record<string, string>>([
        { server: 'https://relay.example.test' },
        { url: 'https://relay.example.test', auto: '1' },
        { utm: 'x' },
    ])('leaves signed-in root query %j to its existing owners', async (params) => {
        navigation.params = params;
        const search = `?${new URLSearchParams(Object.entries(params)).toString()}`;
        atPath('/', search);

        const screen = await show(<Home />);
        expect(screen.findAllByType('Redirect')).toHaveLength(0);
        expect(navigation.replace).not.toHaveBeenCalled();
        expect(window.location.search).toBe(search);
        await screen.unmount();
    });

    it.each(['ios', 'android'])('keeps the current native redirect on %s without a browser location', async (platformOS) => {
        navigation.platformOS = platformOS;
        navigation.params = { utm: 'x' };
        vi.stubGlobal('window', undefined);

        const screen = await show(<Home />);
        expect(screen.findAllByType('Redirect').map((node) => node.props.href)).toEqual(['/desk']);
        expect(screen.findAllByType(MainView)).toHaveLength(0);
        await screen.unmount();
    });

    it('keeps sign-in at / without redirecting a signed-out visitor', async () => {
        const screen = await show(<Home />, false);
        expect(screen.findByTestId('unauth-shell-route-welcome')).not.toBeNull();
        expect(screen.findByTestId('welcome-secondary-login')).not.toBeNull();
        expect(screen.findAllByType('Redirect')).toHaveLength(0);
        expect(navigation.replace).not.toHaveBeenCalled();
        await screen.unmount();
    });

    it.each(['/session/session-test', '/session/session-test/message/message-test', '/settings'])('does not redirect a retained root screen over %s', async (pathname) => {
        atPath(pathname);
        const screen = await show(<Home />);
        expect(screen.findAllByType('Redirect')).toHaveLength(0);
        expect(navigation.replace).not.toHaveBeenCalled();
        await screen.unmount();
    });

    it('keeps the desk mounted at /desk after a reload', async () => {
        atPath('/desk');
        for (let load = 0; load < 2; load += 1) {
            const screen = await show(<DeskPage />);
            expect(screen.findByTestId('ip-tab-work')).not.toBeNull();
            expect(screen.findAllByType('Redirect')).toHaveLength(0);
            expect(navigation.replace).not.toHaveBeenCalled();
            await screen.unmount();
        }
    });

    it('preserves a root session link with its message, server and child target', async () => {
        navigation.params = { id: 'session-test', messageId: 'message-test', serverId: 'server-test', jumpChildId: 'child-test' };
        const screen = await show(<Home />);
        expect(navigation.replace).toHaveBeenCalledWith('/session/session-test/message/message-test?serverId=server-test&jumpChildId=child-test');
        expect(screen.findAllByType('Redirect')).toHaveLength(0);
        await screen.unmount();
    });

    it('leaves a pending terminal connection to the existing continuation owner', async () => {
        setPendingTerminalConnect({ publicKeyB64Url: 'test-key', serverUrl: 'http://localhost:53289' });
        expect(getPendingTerminalConnect()?.publicKeyB64Url).toBe('test-key');
        const screen = await show(<Home />);
        expect(screen.findAllByType('Redirect')).toHaveLength(0);
        expect(navigation.replace).not.toHaveBeenCalled();
        await screen.unmount();
    });
});
