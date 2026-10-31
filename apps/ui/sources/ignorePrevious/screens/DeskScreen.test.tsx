import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppPaneProvider } from '@/components/appShell/panes/AppPaneProvider';
import { renderScreen } from '@/dev/testkit';
import { createSessionFixture } from '@/dev/testkit/fixtures/sessionFixtures';
import type { Session } from '@/sync/domains/state/storageTypes';

import { setApprovalsOpen, setStoredCoordinatorId, setWorkCollapsed } from '../deskPrefs';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const state = vi.hoisted(() => ({ sessions: [] as unknown[], showModal: vi.fn(), multiPane: true }));

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
    return createModalModuleMock({ spies: { show: state.showModal } }).module;
});

vi.mock('@/sync/store/hooks', async (importOriginal) => {
    const { createStoreHooksModuleMock } = await import('@/dev/testkit/mocks/storage');
    return createStoreHooksModuleMock({
        importOriginal,
        overrides: {
            useAllSessions: (() => state.sessions) as never,
            useSessionScmStatus: (() => null) as never,
        },
    });
});

// The multi-pane switch is a local device setting; with it off no pane can be drawn.
vi.mock('@/sync/domains/state/storage', async (importOriginal) => {
    const { createPartialStorageModuleMock } = await import('@/dev/testkit/mocks/storage');
    const actual = await importOriginal<typeof import('@/sync/domains/state/storage')>();
    return createPartialStorageModuleMock(importOriginal, {
        useLocalSetting: ((key: string) =>
            key === 'uiMultiPanePanelsEnabled' ? state.multiPane : (actual.useLocalSetting as (k: string) => unknown)(key)) as never,
    });
});

// SessionView is Happier's whole chat surface (transcript, composer, sockets); the desk only places it.
vi.mock('@/components/sessions/shell/SessionView', async () => {
    const { View } = await import('react-native');
    return { SessionView: ({ id }: { id: string }) => <View testID={`session-view-${id}`} /> };
});

function session(id: string, extra: Partial<Session> = {}): Session {
    return createSessionFixture({
        id,
        active: true,
        updatedAt: 10,
        metadata: { path: '/home/u/dev', host: 'h', homeDir: '/home/u', machineId: 'm', summary: { text: `Title ${id}`, updatedAt: 1 } } as Session['metadata'],
        ...extra,
    });
}

// The desk's approvals drawer is a Happier pane, so it needs the app's pane provider above it.
function Panes({ children }: { children?: React.ReactNode }) {
    return <AppPaneProvider>{children}</AppPaneProvider>;
}

async function renderDesk() {
    const { DeskScreen } = await import('./DeskScreen');
    return renderScreen(<DeskScreen />, { wrapper: Panes });
}

describe('DeskScreen', () => {
    beforeEach(() => {
        setStoredCoordinatorId(null);
        setWorkCollapsed(false);
        setApprovalsOpen(false);
        state.multiPane = true;
        state.showModal.mockClear();
    });

    it('asks for a coordinator when there are no sessions', async () => {
        state.sessions = [];
        const screen = await renderDesk();
        expect(screen.getTextContent()).toContain('Pick the coordinator session');
        expect(screen.getTextContent()).toContain('claude --agent coordinator');
    });

    it('still shows the picker when the stored coordinator was archived', async () => {
        state.sessions = [session('s9', { archivedAt: 5 } as Partial<Session>), session('s1')];
        setStoredCoordinatorId('s9');
        const screen = await renderDesk();
        expect(screen.getTextContent()).toContain('Pick the coordinator session');
        expect(screen.findByTestId('session-view-s9')).toBeNull();
    });

    it('shows the coordinator chat beside the Work panel, with approvals closed', async () => {
        state.sessions = [session('s1'), session('s2')];
        setStoredCoordinatorId('s1');
        const screen = await renderDesk();
        expect(screen.findByTestId('session-view-s1')).toBeTruthy();
        expect(screen.findByTestId('ip-waiting')).toBeNull();
        expect(screen.findByTestId('ip-count-all')).toBeTruthy();
    });

    it('collapses the Work panel to a rail and keeps it collapsed after a reload', async () => {
        state.sessions = [
            session('s1'),
            session('s2', { metadata: { path: '/home/u/dev/wt/atr-6-a', host: 'h', homeDir: '/home/u', machineId: 'm' } as Session['metadata'] }),
        ];
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

    it('opens what waits on you in a drawer from the coordinator header, and remembers it', async () => {
        const bash = { tool: 'Bash', arguments: { command: 'ls' }, createdAt: 1 };
        state.sessions = [session('s1'), session('s2', { agentState: { requests: { r1: bash } } as unknown as Session['agentState'] })];
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

    it('opens what waits on you in a card where no drawer can be drawn', async () => {
        state.multiPane = false;
        state.sessions = [session('s1')];
        setStoredCoordinatorId('s1');
        setApprovalsOpen(true);
        const screen = await renderDesk();
        expect(screen.findByTestId('ip-approvals-open')?.props.accessibilityState).toEqual({ expanded: false });

        await screen.pressByTestIdAsync('ip-approvals-open');
        const { ApprovalsCard } = await import('../components/Approvals');
        expect(state.showModal).toHaveBeenCalledWith(expect.objectContaining({ component: ApprovalsCard }));
        expect(screen.findByTestId('ip-approvals-drawer')).toBeNull();
        const { getApprovalsOpen } = await import('../deskPrefs');
        expect(getApprovalsOpen()).toBe(true);
    });

    it('opens Shog up close from the mask in the coordinator header', async () => {
        state.sessions = [session('s1')];
        setStoredCoordinatorId('s1');
        const screen = await renderDesk();
        await screen.pressByTestIdAsync('ip-shog-open');
        const { ShogView } = await import('../components/ShogView');
        expect(state.showModal).toHaveBeenCalledWith(expect.objectContaining({ component: ShogView }));
    });

    it('opens the chat of the session picked in the picker and remembers it', async () => {
        state.sessions = [session('s1'), session('s2', { updatedAt: 20 })];
        const screen = await renderDesk();
        await screen.pressByTestIdAsync('ip-pick-s2');
        expect(screen.findByTestId('session-view-s2')).toBeTruthy();
        const { getStoredCoordinatorId } = await import('../deskPrefs');
        expect(getStoredCoordinatorId()).toBe('s2');
    });
});
