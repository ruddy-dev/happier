import { beforeEach, describe, expect, it, vi } from 'vitest';
import { findTestInstanceByTypeContainingText, pressTestInstanceAsync, renderScreen } from '@/dev/testkit';
import { createSessionFixture } from '@/dev/testkit/fixtures/sessionFixtures';
import type { Session } from '@/sync/domains/state/storageTypes';

import { setStoredCoordinatorId } from '../coordinatorStore';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const state = vi.hoisted(() => ({ sessions: [] as unknown[] }));

vi.mock('@expo/vector-icons', async () => {
    const { createExpoVectorIconsMock } = await import('@/dev/testkit/mocks/icons');
    return createExpoVectorIconsMock();
});

vi.mock('expo-router', async () => {
    const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
    return createExpoRouterMock().module;
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

async function renderDesk() {
    const { DeskScreen } = await import('./DeskScreen');
    return renderScreen(<DeskScreen />);
}

describe('DeskScreen', () => {
    beforeEach(() => setStoredCoordinatorId(null));

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

    it('shows the coordinator chat beside the waiting and work panels', async () => {
        state.sessions = [session('s1'), session('s2')];
        setStoredCoordinatorId('s1');
        const screen = await renderDesk();
        expect(screen.findByTestId('session-view-s1')).toBeTruthy();
        expect(screen.getTextContent()).toContain('Nothing needs you');
        expect(screen.findByTestId('ip-count-all')).toBeTruthy();
    });

    it('opens the chat of the session picked in the picker and remembers it', async () => {
        state.sessions = [session('s1'), session('s2', { updatedAt: 20 })];
        const screen = await renderDesk();
        await pressTestInstanceAsync(findTestInstanceByTypeContainingText(screen.tree, 'Pressable', 'Title s2')!);
        expect(screen.findByTestId('session-view-s2')).toBeTruthy();
        const { getStoredCoordinatorId } = await import('../coordinatorStore');
        expect(getStoredCoordinatorId()).toBe('s2');
    });
});
