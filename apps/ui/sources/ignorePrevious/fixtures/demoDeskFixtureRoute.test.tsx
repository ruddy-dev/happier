import * as React from 'react';
import { act } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppPaneProvider } from '@/components/appShell/panes/AppPaneProvider';
import { findTestInstanceByTypeContainingText, pressTestInstanceAsync, renderScreen } from '@/dev/testkit';
import { installAgentAssetLoader } from '@/dev/testkit/mocks/agentAssets';
import { storage } from '@/sync/domains/state/storage';

import { getStoredCoordinatorId, setCoordinatorOverride, setStoredCoordinatorId } from '@/ignorePrevious/deskPrefs';

import DeskFixturePage from '@/app/(app)/dev/desk-fixture';
import demo from './demo/desk-demo.json';
import { DEMO_STEP_MS, demoScript } from './demoConversation';

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

const motion = vi.hoisted(() => ({ reduced: false }));
vi.mock('@/hooks/ui/useReducedMotionPreference', async () => {
    const { createReducedMotionModuleMock } = await import('@/dev/testkit/mocks/reducedMotion');
    return createReducedMotionModuleMock(() => motion.reduced);
});

const route = vi.hoisted(() => ({ data: undefined as string | undefined, navigate: vi.fn(), alert: vi.fn(), options: null as Readonly<Record<string, unknown>> | null }));

vi.mock('expo-router', async () => {
    const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
    return createExpoRouterMock({ params: () => ({ data: route.data }), router: { navigate: route.navigate, push: route.navigate }, stackOptionsCapture: { record: value => { route.options = typeof value === 'function' ? value() : value; }, reset: () => { route.options = null; }, getRaw: () => route.options, getResolved: () => route.options } }).module;
});

vi.mock('@/modal', async () => {
    const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
    return createModalModuleMock({ spies: { alert: route.alert } }).module;
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
    return { useAuth: () => React.useSyncExternalStore(auth.subscribe, auth.get, auth.get), getCurrentAuth: () => null };
});

// Pins the active server so the account's warm cache has a key to be written under.
vi.mock('@/sync/domains/server/serverRuntime', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/sync/domains/server/serverRuntime')>();
    return { ...actual, getActiveServerSnapshot: () => ({ ...actual.getActiveServerSnapshot(), serverId: 'srv-test' }) };
});

function Panes({ children }: { children?: React.ReactNode }) {
    return <AppPaneProvider>{children}</AppPaneProvider>;
}

describe('landing demo route', () => {
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
        vi.stubEnv('EXPO_PUBLIC_IP_FIXTURES', '1');
    });
    afterEach(() => {
        vi.useRealTimers();
        motion.reduced = false;
        vi.unstubAllEnvs();
        storage.setState(before, true);
        setCoordinatorOverride(null);
        setStoredCoordinatorId(storedBefore);
        route.data = undefined;
        route.navigate.mockClear();
        route.alert.mockClear();
    });

    it.each([true, false])('C: public presentation is limited to data=demo (%s)', async isDemo => {
        route.data = isDemo ? 'demo' : undefined;
        const screen = await renderScreen(<DeskFixturePage />, { wrapper: Panes });
        await vi.waitFor(() => expect(screen.findByTestId('ip-fixture-coordinator-body')).not.toBeNull());
        expect(route.options?.headerShown).toBe(isDemo ? false : undefined);
        expect(screen.getTextContent().includes('Creature preview')).toBe(!isDemo);
        expect(screen.getTextContent().includes('Fresh start preview')).toBe(!isDemo);
        expect(screen.findByTestId('ip-demo-note') !== null).toBe(isDemo);
        expect(screen.findByTestId('ip-connection-status') !== null).toBe(!isDemo);
        expect(screen.findByTestId('ip-demo-play') !== null).toBe(isDemo);
        await screen.unmount();
    });

    it('C: demo worker Open stays local across Work, Waiting and Sessions', async () => {
        route.data = 'demo';
        const screen = await renderScreen(<DeskFixturePage />, { wrapper: Panes });
        await vi.waitFor(() => expect(screen.findByTestId('ip-fixture-coordinator-body')).not.toBeNull());
        await pressTestInstanceAsync(findTestInstanceByTypeContainingText(screen.tree, 'Pressable', 'Details')!);
        await screen.pressByTestIdAsync('ip-open-worker-demo-weather-tests');
        expect(route.alert).toHaveBeenCalledWith(expect.any(String), expect.stringContaining('worker'));
        await screen.pressByTestIdAsync('ip-open-demo-weather-fix');
        await screen.pressByTestIdAsync('ip-approvals-open');
        await screen.pressByTestIdAsync('ip-waiting-toggle-demo-recipe-search-r1');
        await screen.pressByTestIdAsync('ip-waiting-toggle-demo-recipe-approval-r1');
        await pressTestInstanceAsync(findTestInstanceByTypeContainingText(screen.tree, 'Pressable', 'Open session')!);
        await screen.pressByTestIdAsync('ip-top-sessions');
        await screen.pressByTestIdAsync('ip-sessions-row-demo-weather-tests');
        expect(route.alert).toHaveBeenCalledTimes(4);
        expect(route.navigate).not.toHaveBeenCalled();
        await screen.unmount();
    });

    it('C: data=demo lists demo workers and the ordinary option-card question, with sends inert', async () => {
        route.data = 'demo';
        const screen = await renderScreen(<DeskFixturePage />, { wrapper: Panes });
        await vi.waitFor(async () => {
            await act(async () => {});
            expect(getStoredCoordinatorId()).toBe('demo-coordinator');
            expect(screen.findByTestId('ip-fixture-coordinator-body')).not.toBeNull();
        });
        // The real desk, store, waiting parser and cards are rendered. No parallel fake worker UI.
        await pressTestInstanceAsync(findTestInstanceByTypeContainingText(screen.tree, 'Pressable', 'Details')!);
        expect(screen.findByTestId('ip-mode-current-demo-weather-tests')).not.toBeNull();
        // View access keeps worker mode writes and Stop outside the static demo.
        expect(screen.findByTestId('ip-mode-demo-weather-tests')).toBeNull();
        expect(screen.findByTestId('ip-stop-demo-weather-tests')).toBeNull();
        const text = screen.getTextContent();
        expect(text).toContain('WEATHER-14 Fix the blank forecast');
        expect(text).toContain('WEATHER-15 Check forecast units');
        expect(text).toContain('RECIPE-8 Add ingredient search');
        expect(text).toContain('NOTES-3 Export notes as Markdown');
        await screen.pressByTestIdAsync('ip-approvals-open');
        await screen.pressByTestIdAsync('ip-waiting-toggle-demo-recipe-search-r1');
        await screen.pressByTestIdAsync('ip-waiting-toggle-demo-recipe-approval-r1');
        expect(screen.getTextContent()).toContain('How should ingredient search match recipes?');
        const option = screen.findByTestId('ip-waiting-option-demo-recipe-search-r1-0-0');
        expect(option).not.toBeNull();
        expect(option?.props.disabled).toBe(true);
        await screen.pressByTestIdAsync('ip-waiting-option-demo-recipe-search-r1-0-0');
        expect(option?.props.accessibilityState.selected).toBe(false);
        expect(screen.findByTestId('ip-waiting-send-demo-recipe-search-r1')?.props.disabled).toBe(true);
        expect(screen.findByTestId('ip-waiting-allow-demo-recipe-approval-r1')?.props.disabled).toBe(true);
        expect(screen.findByTestId('ip-waiting-deny-demo-recipe-approval-r1')?.props.disabled).toBe(true);
        expect(screen.getTextContent()).toContain('https://example.com/tiny-weather/pull/42');
        expect(screen.findByTestId('session-view-demo-coordinator')).toBeNull();
        await screen.unmount();
        expect(Object.keys(storage.getState().sessions)).toHaveLength(0);
        expect(Object.keys(storage.getState().sessionMessages)).toHaveLength(0);
    });

    it.each([false, true])('C: controls play, pause, resume, restart and finish with reduced motion=%s', async reduced => {
        route.data = 'demo';
        motion.reduced = reduced;
        const scrollToEnd = vi.fn();
        const screen = await renderScreen(<DeskFixturePage />, {
            wrapper: Panes,
            // Native scrolling is a host boundary; the fixture's callback and motion decision run for real.
            createNodeMock: element => {
                const props = element.props;
                return props && typeof props === 'object' && 'testID' in props && props.testID === 'ip-fixture-coordinator-body' ? { scrollToEnd } : null;
            },
        });
        await vi.waitFor(async () => {
            await act(async () => {});
            expect(screen.findByTestId('ip-demo-play')).not.toBeNull();
        });
        expect(screen.getTextContent()).toContain('Simulate conversation');
        expect(screen.findByTestId('ip-demo-restart')).toBeNull();
        vi.useFakeTimers();
        await screen.pressByTestIdAsync('ip-demo-play');
        expect(screen.getTextContent()).toContain('Pause');
        expect(screen.getTextContent()).not.toContain(demo.coordinatorBody.transcript[0].text);
        await act(async () => { vi.advanceTimersByTime(DEMO_STEP_MS); });
        expect(screen.getTextContent()).toContain(demo.coordinatorBody.transcript[0].text);
        const body = screen.findByTestId('ip-fixture-coordinator-body')!;
        await act(async () => { body.props.onContentSizeChange(500, 1000); });
        expect(scrollToEnd).toHaveBeenLastCalledWith({ animated: !reduced });
        // Whole lines appear at the step boundary, including with reduced motion. No typing ticks.
        const textAtTick = screen.getTextContent();
        await act(async () => { vi.advanceTimersByTime(100); });
        expect(screen.getTextContent()).toBe(textAtTick);
        await screen.pressByTestIdAsync('ip-demo-play');
        expect(screen.getTextContent()).toContain('Resume');
        const paused = screen.getTextContent();
        await act(async () => { vi.advanceTimersByTime(DEMO_STEP_MS * 3); });
        expect(screen.getTextContent()).toBe(paused);
        await screen.pressByTestIdAsync('ip-demo-play');
        await act(async () => { vi.advanceTimersByTime(DEMO_STEP_MS); });
        expect(storage.getState().sessionMessages[demoScript[1].sessionId]?.messagesById).toBeDefined();
        await act(async () => { vi.advanceTimersByTime(DEMO_STEP_MS); });
        expect(screen.getTextContent()).toContain(demo.coordinatorBody.transcript[1].text);
        await screen.pressByTestIdAsync('ip-demo-restart');
        expect(screen.getTextContent()).not.toContain(demo.coordinatorBody.transcript[0].text);
        await screen.pressByTestIdAsync('ip-approvals-open');
        const questionIndex = demoScript.findIndex(step => step.sessionId === 'demo-recipe-search' && step.line.from === 'agent');
        await act(async () => { vi.advanceTimersByTime(DEMO_STEP_MS * questionIndex); });
        expect(screen.getTextContent()).not.toContain('How should ingredient search match recipes?');
        await act(async () => { vi.advanceTimersByTime(DEMO_STEP_MS); });
        await screen.pressByTestIdAsync('ip-waiting-toggle-demo-recipe-search-r1');
        expect(screen.getTextContent()).toContain('How should ingredient search match recipes?');
        expect(screen.findByTestId('ip-waiting-send-demo-recipe-search-r1')?.props.disabled).toBe(true);
        await act(async () => { vi.advanceTimersByTime(DEMO_STEP_MS * (demoScript.length - questionIndex - 1)); });
        expect(screen.getTextContent()).toContain('Simulate conversation');
        expect(screen.findByTestId('ip-demo-restart')).not.toBeNull();
        expect(screen.getTextContent()).toContain(demo.coordinatorBody.transcript.at(-1)!.text);
        scrollToEnd.mockClear();
        await act(async () => { body.props.onContentSizeChange(500, 2000); });
        expect(scrollToEnd).toHaveBeenCalledWith({ animated: !reduced });
        await screen.pressByTestIdAsync('ip-demo-restart');
        await screen.unmount();
        const writes = vi.fn();
        const unsubscribe = storage.subscribe(writes);
        await act(async () => { vi.advanceTimersByTime(DEMO_STEP_MS * demoScript.length); });
        expect(writes).not.toHaveBeenCalled();
        unsubscribe();
    });

    it.each([undefined, 'unknown'])('C: data=%s keeps the original five-session fixture and transcript', async data => {
        route.data = data;
        const screen = await renderScreen(<DeskFixturePage />, { wrapper: Panes });
        await vi.waitFor(async () => {
            await act(async () => {});
            expect(screen.findByTestId('ip-fixture-coordinator-body')).not.toBeNull();
        });
        expect(screen.findByTestId('ip-demo-play')).toBeNull();
        expect(getStoredCoordinatorId()).toBe('fx-coord');
        expect(Object.keys(storage.getState().sessions).sort()).toEqual(['fx-coord', 'fx-w1', 'fx-w2', 'fx-w3', 'fx-w4']);
        expect(screen.getTextContent()).toContain('What is waiting on me?');
        expect(screen.getTextContent()).not.toContain('How should ingredient search match recipes?');
        await screen.unmount();
    });
});

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock({ useWindowDimensions: () => ({ width: 1440, height: 900, scale: 1, fontScale: 1 }) });
});
