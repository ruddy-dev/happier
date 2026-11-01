import { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findTestInstanceByTypeContainingText, pressTestInstanceAsync, renderScreen } from '@/dev/testkit';
import { createMachineFixture } from '@/dev/testkit/fixtures/machineFixtures';
import { createSessionFixture } from '@/dev/testkit/fixtures/sessionFixtures';
import { flushHookEffects } from '@/dev/testkit/hooks/flushHookEffects';
import { SESSION_RUNTIME_STATUS_STALE_SIGNAL_MS as STALE } from '@/sync/domains/session/attention/deriveSessionRuntimePresentationState';
import { buildSessionListRenderableFromSession } from '@/sync/domains/session/listing/sessionListRenderable';
import { storage } from '@/sync/domains/state/storage';
import type { Session } from '@/sync/domains/state/storageTypes';

import { DESK_TICK_MS } from '../model/useDeskNow';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

/** Loads sessions the way a warm app holds them: in the sidebar's list and as full records. */
function seed(sessions: Session[]) {
    state.sessions = sessions;
    state.list = sessions.map((s) => buildSessionListRenderableFromSession(s));
    // The row's actions read the record from the real store.
    storage.getState().applySessions(sessions);
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
        metadata: { path, host: 'h', homeDir: '/home/u', machineId: 'm', flavor: 'claude', summary: { text: `Title ${id}`, updatedAt: 1 } } as Session['metadata'],
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

    it('shows a worker before its record loads, without a mode or context it does not know yet', async () => {
        state.branches = {};
        const s1 = session('s1', '/home/u/dev/wt/atr-6-a', { permissionMode: 'acceptEdits' } as Partial<Session>);
        state.list = [buildSessionListRenderableFromSession(s1)];
        state.sessions = [];
        const screen = await renderColumn();
        await pressTestInstanceAsync(findTestInstanceByTypeContainingText(screen.tree, 'Pressable', 'Details')!);
        const text = screen.getTextContent();
        expect(text).toContain('Title s1');
        expect(text).not.toContain('acceptEdits');
        expect(text).not.toContain('default');
        expect(screen.findByTestId('ip-worker-context-s1')).toBeNull();
    });

    it('offers Stop on a busy worker and the resume control on an inactive one', async () => {
        state.branches = {};
        storage.getState().applyMachines([createMachineFixture({ id: 'm', active: true, activeAt: Date.now() })]);
        seed([
            session('busy', '/home/u/dev/wt/atr-13-a', { active: true, thinking: true, thinkingAt: Date.now() }),
            session('asleep', '/home/u/dev/wt/atr-13-b', { active: false }),
        ]);
        const screen = await renderColumn();
        await pressTestInstanceAsync(findTestInstanceByTypeContainingText(screen.tree, 'Pressable', 'Details')!);
        expect(screen.findByTestId('ip-stop-busy')).not.toBeNull();
        expect(screen.findByTestId('ip-stop-asleep')).toBeNull();
        expect(screen.findByTestId('ip-resume-asleep')).not.toBeNull();
        expect(screen.findByTestId('ip-resume-busy')).toBeNull();
    });

    it('prefers the session branch over the folder name', async () => {
        state.branches = { s2: 'hub-59-store-skill' };
        seed([session('s2', '/home/u/dev')]);
        const screen = await renderColumn();
        expect(screen.getTextContent()).toContain('HUB-59');
        expect(screen.getTextContent()).not.toContain('No issue');
    });
});

describe('WorkColumn freshness (F1)', () => {
    const t0 = Date.UTC(2026, 10, 1, 9, 0, 0);
    let previous: ReturnType<typeof storage.getState>;
    beforeEach(() => {
        previous = storage.getState();
        vi.useFakeTimers();
        vi.setSystemTime(t0);
        state.branches = {};
    });
    afterEach(() => {
        storage.setState(previous, true);
        vi.useRealTimers();
    });

    /** A worker whose last signal ("thinking") came at `at`. */
    function thinking(id: string, at: number, version = 1): Session {
        return session(id, `/home/u/dev/wt/atr-6-${id}`, {
            active: true,
            thinking: true,
            thinkingAt: at,
            activeAt: at,
            seq: version,
            updatedAt: at,
        });
    }

    async function tick(ms: number) {
        await flushHookEffects({ advanceTimersMs: ms, cycles: 1 });
    }

    function count(screen: Awaited<ReturnType<typeof renderColumn>>, id: string) {
        return screen.findByTestId(`ip-count-${id}`)?.props.children;
    }

    it('F1 a thinking worker still counts as working just inside the budget', async () => {
        seed([thinking('w1', t0)]);
        const screen = await renderColumn();
        await tick(STALE - 1_000);
        expect(count(screen, 'working')).toBe(1);
    });

    it('F1 the same worker stops counting as working with no store write', async () => {
        seed([thinking('w1', t0)]);
        const screen = await renderColumn();
        const w1 = storage.getState().sessions.w1;
        await tick(STALE + DESK_TICK_MS);
        // The store still holds the same record, so the desk clock is what moved the count.
        expect(storage.getState().sessions.w1).toBe(w1);
        expect(count(screen, 'working')).toBe(0);
    });

    it('F1 control: a fresh version-stamped write keeps it working', async () => {
        seed([thinking('w1', t0)]);
        const screen = await renderColumn();
        await tick(100_000);
        act(() => {
            seed([thinking('w1', t0 + 100_000, 2)]);
        });
        await tick(25_000);
        expect(count(screen, 'working')).toBe(1);
    });

    it('F1 one shared timer, gone after unmount', async () => {
        const base = vi.getTimerCount();
        seed(['a', 'b', 'c', 'd', 'e'].map((id) => thinking(id, t0)));
        const screen = await renderColumn();
        expect(vi.getTimerCount()).toBe(base + 1);
        await screen.unmount();
        expect(vi.getTimerCount()).toBe(base);
    });
});
