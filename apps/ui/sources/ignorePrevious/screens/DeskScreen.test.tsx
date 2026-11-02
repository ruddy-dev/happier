import * as React from 'react';
import { act } from 'react';
import { Platform } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderScreen } from '@/dev/testkit';
import { readReactNativeMmkvStubEntries, resetReactNativeMmkvStub } from '@/dev/testkit/mocks/mmkv';
import { createSessionFixture } from '@/dev/testkit/fixtures/sessionFixtures';
import { buildSessionListRenderableFromSession } from '@/sync/domains/session/listing/sessionListRenderable';
import { storage } from '@/sync/domains/state/storage';
import type { Session } from '@/sync/domains/state/storageTypes';

import { setApprovalsOpen, setStoredCoordinatorId, setWorkCollapsed } from '../deskPrefs';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const state = vi.hoisted(() => ({
    showModal: vi.fn(),
    hydration: 'available' as 'available' | 'loading',
    hydrated: [] as string[],
}));

// Stored-open restoration is a desktop choice; phones intentionally start closed (Medium 1).
vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock({ useWindowDimensions: () => ({ width: 1440, height: 900, scale: 1, fontScale: 1 }) });
});

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
    return createExpoRouterMock({ pathname: '/desk' }).module;
});

vi.mock('@/modal', async () => {
    const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
    return createModalModuleMock({ spies: { show: state.showModal } }).module;
});

// SessionView is Happier's whole chat surface (transcript, composer, sockets); the desk only places it.
// SessionView shows its own loading, retrying and missing states from the hydration state it is given.
vi.mock('@/components/sessions/shell/SessionView', async () => {
    const { deskScreenMocks } = await import('../testkit/deskScreenMocks');
    return deskScreenMocks.sessionView();
});

// Fetching a session record the store doesn't hold yet goes over the network; the route uses the same hook.
// Kept inline (not deskScreenMocks) because the cold-load test needs a 'loading' result and the fetched ids.
vi.mock('@/hooks/session/useHydrateSessionForRoute', () => ({
    useHydrateSessionForRoute: (sessionId: string) => {
        state.hydrated.push(sessionId);
        return { kind: state.hydration, sessionId };
    },
}));

function session(id: string, extra: Partial<Session> = {}): Session {
    return createSessionFixture({
        id,
        active: true,
        updatedAt: 10,
        metadata: { path: '/home/u/dev', host: 'h', homeDir: '/home/u', machineId: 'm', summary: { text: `Title ${id}`, updatedAt: 1 } } as Session['metadata'],
        ...extra,
    });
}

/**
 * Loads sessions into the real store the way the first sync does: list rows and full records.
 * `ready: false` leaves the store before its first sync has finished.
 */
function seed(sessions: Session[], { ready = true }: { ready?: boolean } = {}) {
    act(() => {
        storage.getState().applySessions(sessions);
        if (ready) storage.getState().applyReady();
    });
}

async function renderDesk() {
    const { DeskScreen } = await import('./DeskScreen');
    return renderScreen(<DeskScreen />);
}

describe('DeskScreen', () => {
    let previous: ReturnType<typeof storage.getState>;
    let previousPlatform: typeof Platform.OS;
    afterEach(() => {
        Platform.OS = previousPlatform;
        act(() => {
            storage.setState(previous, true);
        });
    });

    beforeEach(() => {
        previousPlatform = Platform.OS;
        Platform.OS = 'web';
        previous = storage.getState();
        setStoredCoordinatorId(null);
        setWorkCollapsed(false);
        setApprovalsOpen(false);
        storage.getState().applyLocalSettings({ uiMultiPanePanelsEnabled: true });
        state.hydration = 'available';
        state.hydrated = [];
        state.showModal.mockClear();
    });

    it('mounts without writing device preferences when nothing is stored', async () => {
        seed([]);
        resetReactNativeMmkvStub();
        await renderDesk();
        expect(readReactNativeMmkvStubEntries()).toEqual([]);
    });

    it('asks for a coordinator when there are no sessions', async () => {
        seed([]);
        const screen = await renderDesk();
        expect(screen.findAllByProps({ 'data-ip-font': 'desk' })).toHaveLength(1);
        expect(screen.getTextContent()).toContain('Pick the coordinator session');
        expect(screen.getTextContent()).toContain('claude --agent coordinator');
    });

    it('waits for the session list before asking for a coordinator', async () => {
        seed([], { ready: false });
        setStoredCoordinatorId('s1');
        const screen = await renderDesk();
        expect(screen.getTextContent()).not.toContain('Pick the coordinator session');
        expect(screen.findByTestId('ip-approvals-open')).toBeTruthy();
    });

    it('still shows the picker when the stored coordinator was archived', async () => {
        seed([session('s9', { archivedAt: 5 } as Partial<Session>), session('s1')]);
        setStoredCoordinatorId('s9');
        const screen = await renderDesk();
        expect(screen.getTextContent()).toContain('Pick the coordinator session');
        expect(screen.findByTestId('session-view-s9')).toBeNull();
    });

    it('shows the coordinator chat beside the Work panel, with approvals closed', async () => {
        seed([session('s1'), session('s2')]);
        setStoredCoordinatorId('s1');
        const screen = await renderDesk();
        expect(screen.findByTestId('session-view-s1')).toBeTruthy();
        expect(screen.findByTestId('ip-waiting')).toBeNull();
        expect(screen.findByTestId('ip-count-all')).toBeTruthy();
    });

    it('collapses the Work panel to a rail and keeps it collapsed after a reload', async () => {
        seed([
            session('s1'),
            session('s2', { metadata: { path: '/home/u/dev/wt/atr-6-a', host: 'h', homeDir: '/home/u', machineId: 'm' } as Session['metadata'] }),
        ]);
        setStoredCoordinatorId('s1');
        let screen = await renderDesk();
        await screen.pressByTestIdAsync('ip-work-collapse');
        expect(screen.findByTestId('session-view-s1')).toBeTruthy();
        expect(screen.findByTestId('ip-count-all')).toBeNull();
        expect(screen.findByTestId('ip-rail-issue-ATR-6')).toBeTruthy();

        await screen.unmount();
        screen = await renderDesk();
        expect(screen.findByTestId('ip-rail-issue-ATR-6')).toBeTruthy();

        await screen.pressByTestIdAsync('ip-work-expand');
        expect(screen.findByTestId('ip-count-all')).toBeTruthy();
    });

    it('updates the Work layout when another prefs consumer changes the stored flag', async () => {
        seed([]);
        const screen = await renderDesk();
        await act(async () => setWorkCollapsed(true));
        expect(screen.findByTestId('ip-work-rail')).not.toBeNull();
        expect(screen.findByTestId('ip-work')).toBeNull();
    });

    it('opens what waits on you in a drawer from the coordinator header, and remembers it', async () => {
        const bash = { tool: 'Bash', arguments: { command: 'ls' }, createdAt: 1 };
        seed([session('s1'), session('s2', { agentState: { requests: { r1: bash } } as unknown as Session['agentState'] })]);
        setStoredCoordinatorId('s1');
        let screen = await renderDesk();
        expect(screen.findByTestId('ip-waiting')).toBeNull();
        expect(screen.findByTestId('ip-approvals-count')?.props.children).toBe(1);

        await screen.pressByTestIdAsync('ip-approvals-open');
        expect(screen.findByTestId('ip-waiting')).toBeTruthy();
        expect(screen.findByTestId('session-view-s1')).toBeTruthy();

        await screen.unmount();
        screen = await renderDesk();
        expect(screen.findByTestId('ip-waiting')).toBeTruthy();

        await screen.pressByTestIdAsync('ip-approvals-close');
        expect(screen.findByTestId('ip-waiting')).toBeNull();
        await screen.unmount();
        screen = await renderDesk();
        expect(screen.findByTestId('ip-waiting')).toBeNull();
    });

    it('D-series: keeps Waiting non-modal even with upstream multi-pane disabled', async () => {
        storage.getState().applyLocalSettings({ uiMultiPanePanelsEnabled: false });
        seed([session('s1')]);
        setStoredCoordinatorId('s1');
        setApprovalsOpen(true);
        const screen = await renderDesk();
        expect(screen.findByTestId('ip-approvals-open')?.props.accessibilityState).toEqual({ expanded: true });
        expect(screen.findByTestId('ip-approvals-drawer')).toBeTruthy();

        await screen.pressByTestIdAsync('ip-approvals-open');
        expect(state.showModal).not.toHaveBeenCalled();
        expect(screen.findByTestId('ip-approvals-drawer')).toBeNull();
        const { getApprovalsOpen } = await import('../deskPrefs');
        expect(getApprovalsOpen()).toBe(false);
    });

    it('opens Shog up close from the mask in the coordinator header', async () => {
        seed([session('s1')]);
        setStoredCoordinatorId('s1');
        const screen = await renderDesk();
        await screen.pressByTestIdAsync('ip-shog-open');
        const { ShogView } = await import('../components/ShogView');
        expect(screen.tree.root.findAllByType(ShogView)).toHaveLength(1);
        expect(state.showModal).not.toHaveBeenCalled();
    });

    it('reads the sidebar list on a cold load, before any session record has loaded', async () => {
        const bash = { tool: 'Bash', arguments: { command: 'ls' }, createdAt: 1 };
        const s1 = session('s1');
        const s2 = session('s2', { agentState: { requests: { r1: bash } } as unknown as Session['agentState'] });
        // Only the sidebar's rows have arrived; no full session record is loaded.
        act(() => {
            storage.getState().mergeSessionListRenderables([s1, s2].map((s) => buildSessionListRenderableFromSession(s)));
            storage.getState().applyReady();
        });
        state.hydration = 'loading';
        setStoredCoordinatorId('s1');
        const screen = await renderDesk();
        // The coordinator's own record is fetched, and the chat is told it is on its way rather than gone.
        expect(state.hydrated).toContain('s1');
        expect(screen.findByTestId('session-view-s1')?.props.accessibilityHint).toBe('loading');
        // s1 is the coordinator, so only s2 counts as a worker (L1).
        expect(screen.findByTestId('ip-count-all')?.props.children).toBe(1);
        // s2's request lives in a record not loaded yet, so it counts as one thing to look at.
        expect(screen.findByTestId('ip-approvals-count')?.props.children).toBe(1);
    });

    it('opens the chat of the session picked in the picker and remembers it', async () => {
        seed([session('s1'), session('s2', { updatedAt: 20 })]);
        const screen = await renderDesk();
        await screen.pressByTestIdAsync('ip-pick-s2');
        expect(screen.findByTestId('session-view-s2')).toBeTruthy();
        const { getStoredCoordinatorId } = await import('../deskPrefs');
        expect(getStoredCoordinatorId()).toBe('s2');
    });
});
