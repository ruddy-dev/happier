import * as React from 'react';
import * as SecureStore from 'expo-secure-store';
import { prepareWarmCacheEncryptionKey } from '@/sync/domains/state/warmCacheEncryptionKey';
import { MMKV } from 'react-native-mmkv';
import { act } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppPaneProvider } from '@/components/appShell/panes/AppPaneProvider';
import { renderScreen } from '@/dev/testkit';
import { installAgentAssetLoader } from '@/dev/testkit/mocks/agentAssets';
import { createSessionFixture } from '@/dev/testkit/fixtures/sessionFixtures';
import { storage } from '@/sync/domains/state/storage';
import { loadSessionListWarmCacheEntries, readPersistedSessionListWarmCacheEntries, setWarmCacheAccountScope } from '@/sync/domains/state/warmCachePersistence';

import { getStoredCoordinatorId, setCoordinatorOverride, setStoredCoordinatorId } from '@/ignorePrevious/deskPrefs';

import DeskFixturePage from '@/app/(app)/dev/desk-fixture';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock();
});

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

// A test-owned sign-in state, so a test can sign in while the route is open.
const auth = vi.hoisted(() => {
    const state = { isAuthenticated: false, credentials: null as { token: string; secret: string } | null };
    const listeners = new Set<() => void>();
    let snapshot = { ...state };
    return {
        set(next: Partial<typeof state>) {
            Object.assign(state, next);
            snapshot = { ...state };
            for (const listener of [...listeners]) listener();
        },
        subscribe(listener: () => void) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        get: () => snapshot,
    };
});

vi.mock('@/auth/context/AuthContext', async () => {
    const React = await import('react');
    return { useAuth: () => React.useSyncExternalStore(auth.subscribe, auth.get, auth.get) };
});

// Pins the active server so the account's warm cache has a key to be written under.
vi.mock('@/sync/domains/server/serverRuntime', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/sync/domains/server/serverRuntime')>();
    return { ...actual, getActiveServerSnapshot: () => ({ ...actual.getActiveServerSnapshot(), serverId: 'srv-test' }) };
});

function Panes({ children }: { children?: React.ReactNode }) {
    return <AppPaneProvider>{children}</AppPaneProvider>;
}

describe('dev/desk-fixture route', () => {
    const before = storage.getState();
    const storedBefore = getStoredCoordinatorId();

    beforeAll(async () => {
        await installAgentAssetLoader();
        // Load the real lazy composer graph before the route's render assertions.
        await act(async () => { await import('./CoordinatorBodyStub'); });
    });
    afterAll(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });
    beforeEach(() => {
        storage.setState(before, true);
        setStoredCoordinatorId(null);
        setCoordinatorOverride(null);
        auth.set({ isAuthenticated: false, credentials: null });
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        storage.setState(before, true);
        setCoordinatorOverride(null);
        setStoredCoordinatorId(storedBefore);
        setWarmCacheAccountScope(null);
        auth.set({ isAuthenticated: false, credentials: null });
    });

    async function showFixtureDesk() {
        vi.stubEnv('EXPO_PUBLIC_IP_FIXTURES', '1');
        const screen = await renderScreen(<DeskFixturePage />, { wrapper: Panes });
        await vi.waitFor(async () => {
            await act(async () => {});
            expect(screen.findByTestId('ip-fixture-coordinator-body')).not.toBeNull();
        });
        return screen;
    }

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
        // The desk found the fixture's coordinator (otherwise it would show the picker, not the coordinator pane).
        expect(getStoredCoordinatorId()).toBe('fx-coord');
        await screen.unmount();
    });

    it('R48: opens the production robot picker offline, restores picks after reopening and leaves account settings alone', async () => {
        const screen = await showFixtureDesk();
        const settings = storage.getState().settings;
        const profile = storage.getState().profile;
        const sessions = storage.getState().sessions;
        expect(screen.findByTestId('ip-robot-fixture-toggle')).not.toBeNull();
        await screen.pressByTestIdAsync('ip-robot-fixture-toggle');
        expect(screen.findByTestId('ip-robot-picker-codex')).not.toBeNull();
        await screen.pressByTestIdAsync('ip-no-worker-ipb');
        expect(screen.findByTestId('ip-codex-robot-model')!.props.accessibilityState).toEqual({ checked: true });
        await screen.pressByTestIdAsync('ip-codex-robot-loupe');
        await screen.pressByTestIdAsync('ip-robot-fixture-toggle');
        expect(screen.findByTestId('ip-robot-picker-codex')).toBeNull();
        await screen.pressByTestIdAsync('ip-robot-fixture-toggle');
        expect(screen.findByTestId('ip-codex-robot-loupe')!.props.accessibilityState).toEqual({ checked: true });
        expect(screen.findByTestId('ip-no-worker-ipb')!.props.accessibilityState).toEqual({ checked: true });
        expect(storage.getState().settings).toBe(settings);
        expect(storage.getState().profile).toBe(profile);
        expect(storage.getState().sessions).toBe(sessions);
        await act(async () => auth.set({ isAuthenticated: true }));
        expect(screen.findByTestId('ip-robot-fixture-toggle')).toBeNull();
        expect(screen.findByTestId('ip-robot-picker-codex')).toBeNull();
        expect(screen.findByTestId('ip-fixture-signed-in')).not.toBeNull();
        await screen.unmount();
    });

    it('leaves a coordinator choice already stored on this device alone', async () => {
        setStoredCoordinatorId('real-coord-session');

        const screen = await showFixtureDesk();
        expect(getStoredCoordinatorId()).toBe('fx-coord');
        await screen.unmount();

        expect(getStoredCoordinatorId()).toBe('real-coord-session');
    });

    it('takes the fixture sessions out of the store when the route is left', async () => {
        const screen = await showFixtureDesk();
        expect(Object.keys(storage.getState().sessions)).toContain('fx-coord');

        await screen.unmount();

        expect(Object.keys(storage.getState().sessions)).toEqual([]);
        expect(storage.getState().isDataReady).toBe(false);
    });

    it.each([
        ['an authenticated session', { isAuthenticated: true, credentials: null }],
        ['stored credentials', { isAuthenticated: false, credentials: { token: 't', secret: 's' } }],
    ])('refuses to seed over %s and says why', async (_label, signedIn) => {
        auth.set(signedIn);
        storage.getState().applySessions([createSessionFixture({ id: 'real-1', active: true })]);
        vi.stubEnv('EXPO_PUBLIC_IP_FIXTURES', '1');

        const screen = await renderScreen(<DeskFixturePage />, { wrapper: Panes });
        await act(async () => {});

        expect(screen.findByTestId('ip-fixture-signed-in')).not.toBeNull();
        expect(screen.findByTestId('ip-work')).toBeNull();
        expect(Object.keys(storage.getState().sessions)).toEqual(['real-1']);
        await screen.unmount();
        expect(Object.keys(storage.getState().sessions)).toEqual(['real-1']);
    });

    it('refuses to seed when the store already holds an account profile', async () => {
        storage.setState({ profile: { ...storage.getState().profile, id: 'acct-1' } });

        vi.stubEnv('EXPO_PUBLIC_IP_FIXTURES', '1');
        const screen = await renderScreen(<DeskFixturePage />, { wrapper: Panes });
        await act(async () => {});

        expect(screen.findByTestId('ip-fixture-signed-in')).not.toBeNull();
        expect(Object.keys(storage.getState().sessions)).toEqual([]);
        await screen.unmount();
    });

    it('clears the fixture the moment credentials arrive while the route is open', async () => {
        const screen = await showFixtureDesk();

        await act(async () => {
            auth.set({ isAuthenticated: true });
        });

        expect(screen.findByTestId('ip-fixture-signed-in')).not.toBeNull();
        expect(screen.findByTestId('ip-work')).toBeNull();
        expect(Object.keys(storage.getState().sessions)).toEqual([]);
        await screen.unmount();
    });

    it('persists no fixture session to the account warm cache once someone signs in after a signed-out visit', async () => {
        const screen = await showFixtureDesk();
        await screen.unmount();

        // Sign in: the account scope exists and a real session arrives; the warm cache saves after its debounce.
        setWarmCacheAccountScope('acct-test');
        storage.setState({ profile: { ...storage.getState().profile, id: 'acct-test' } });
        storage.getState().applySessions([createSessionFixture({ id: 'real-1', active: true })]);
        await new Promise((resolve) => setTimeout(resolve, 1_500));

        const persisted = Object.keys(readPersistedSessionListWarmCacheEntries('srv-test', 'acct-test') ?? {});
        expect(persisted).toContain('real-1');
        expect(persisted.filter((id) => id.startsWith('fx-'))).toEqual([]);
    });
    it('never writes fixture ids during sign-in cleanup, including intermediate writes', async () => {
        const secureRead = vi.spyOn(SecureStore, 'getItemAsync').mockResolvedValue('test-cache-key-16');
        await prepareWarmCacheEncryptionKey();
        secureRead.mockRestore();
        storage.getState().applySessions([createSessionFixture({ id: 'real-cleanup', active: true })]);
        const screen = await showFixtureDesk();
        setWarmCacheAccountScope('acct-cleanup');
        const observed: string[][] = [];
        const originalSet = MMKV.prototype.set;
        // Observe each platform write, reading it back through the real cache parser.
        const write = vi.spyOn(MMKV.prototype, 'set').mockImplementation(function (this: MMKV, key, value) {
            originalSet.call(this, key, value);
            if (key.startsWith('session-list-warm-cache-v1')) {
                observed.push(Object.keys(loadSessionListWarmCacheEntries('srv-test', 'acct-cleanup')));
            }
        });
        try {
            await act(async () => { auth.set({ isAuthenticated: true, credentials: { token: 't', secret: 's' } }); });
            expect(observed.length).toBeGreaterThan(0);
            expect(observed.flat().filter((id) => id.startsWith('fx-'))).toEqual([]);
            expect(Object.keys(loadSessionListWarmCacheEntries('srv-test', 'acct-cleanup'))).toEqual(['real-cleanup']);
        } finally {
            write.mockRestore();
            await screen.unmount();
        }
    });

});

// These scenarios exercise the concurrent desktop panes. Phone navigation has its own tests.
vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock({ useWindowDimensions: () => ({ width: 1440, height: 900, scale: 1, fontScale: 1 }) });
});
