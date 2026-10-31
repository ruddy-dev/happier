import { describe, expect, it, vi } from 'vitest';
import { renderScreen } from '@/dev/testkit';
import { createSessionFixture } from '@/dev/testkit/fixtures/sessionFixtures';
import { buildSessionListRenderableFromSession } from '@/sync/domains/session/listing/sessionListRenderable';
import type { Session } from '@/sync/domains/state/storageTypes';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

/** Loads sessions the way a warm app holds them: in the sidebar's list and as full records. */
function seed(sessions: Session[]) {
    state.sessions = sessions;
    state.list = sessions.map((s) => buildSessionListRenderableFromSession(s));
}

const state = vi.hoisted(() => ({
    sessions: [] as unknown[],
    list: [] as unknown[],
    branches: {} as Record<string, string>,
}));

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
            useAllSessionListRenderables: (() => state.list) as never,
            useSessionScmStatus: ((id: string) => (state.branches[id] ? { branch: state.branches[id] } : null)) as never,
        },
    });
});

function session(id: string, path: string, extra: Partial<Session> = {}): Session {
    return createSessionFixture({
        id,
        updatedAt: 10,
        metadata: { path, host: 'h', homeDir: '/home/u', machineId: 'm', summary: { text: `Title ${id}`, updatedAt: 1 } } as Session['metadata'],
        ...extra,
    });
}

async function renderColumn() {
    const { WorkColumn } = await import('./WorkColumn');
    return renderScreen(<WorkColumn />);
}

describe('WorkColumn', () => {
    it('groups live workers by issue, puts No issue last and leaves out archived ones', async () => {
        state.branches = {};
        seed([
            session('s1', '/home/u/dev/wt/atr-6-overlay', { active: true, thinking: true, thinkingAt: Date.now() }),
            session('s2', '/home/u/dev'),
            session('s3', '/home/u/dev/wt/atr-6-x', { archivedAt: 5 } as Partial<Session>),
        ]);
        const screen = await renderColumn();
        const text = screen.getTextContent();
        expect(text).toContain('ATR-6');
        expect(text).toContain('Title s1');
        expect(text).not.toContain('Title s3');
        expect(text.indexOf('ATR-6')).toBeLessThan(text.indexOf('No issue'));
    });

    it('counts agents by state in numbers', async () => {
        state.branches = {};
        seed([
            session('s1', '/home/u/dev/wt/atr-6-a', { active: true, thinking: true, thinkingAt: Date.now() }),
            session('s2', '/home/u/dev/wt/atr-6-b', { active: true, thinking: true, thinkingAt: Date.now() }),
            session('s3', '/home/u/dev'),
            session('s4', '/home/u/dev/wt/atr-6-x', { archivedAt: 5 } as Partial<Session>),
        ]);
        const screen = await renderColumn();
        const count = (id: string) => screen.findByTestId(`ip-count-${id}`)?.props.children;
        expect(count('all')).toBe(3);
        expect(count('working')).toBe(2);
        expect(count('idle')).toBe(1);
        expect(count('turn')).toBe(0);
        expect(count('stuck')).toBe(0);
    });

    it('prefers the session branch over the folder name', async () => {
        state.branches = { s2: 'hub-59-store-skill' };
        seed([session('s2', '/home/u/dev')]);
        const screen = await renderColumn();
        expect(screen.getTextContent()).toContain('HUB-59');
        expect(screen.getTextContent()).not.toContain('No issue');
    });
});
