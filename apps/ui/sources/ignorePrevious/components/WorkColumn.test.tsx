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

/** Loads sessions into the real store the way the first sync does: list rows and full records. */
function seed(sessions: Session[]) {
    act(() => {
        storage.getState().applySessions(sessions);
        storage.getState().applyReady();
    });
}

/** Only the sidebar's list rows, before any full record has loaded. */
function seedListOnly(sessions: Session[]) {
    act(() => {
        storage.getState().mergeSessionListRenderables(sessions.map((s) => buildSessionListRenderableFromSession(s)));
        storage.getState().applyReady();
    });
}

function setBranch(sessionId: string, branch: string) {
    act(() => {
        storage.getState().applyScmStatus(sessionId, {
            branch,
            isDirty: false,
            modifiedCount: 0,
            untrackedCount: 0,
            includedCount: 0,
            lastUpdatedAt: 1,
            includedLinesAdded: 0,
            includedLinesRemoved: 0,
            pendingLinesAdded: 0,
            pendingLinesRemoved: 0,
            linesAdded: 0,
            linesRemoved: 0,
            linesChanged: 0,
        });
    });
}

vi.mock('@expo/vector-icons', async () => {
    const { createExpoVectorIconsMock } = await import('@/dev/testkit/mocks/icons');
    return createExpoVectorIconsMock();
});

vi.mock('expo-router', async () => {
    const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
    return createExpoRouterMock().module;
});

// Whether the desk is the focused screen comes from the navigator; a session opened on top of the
// desk leaves it mounted but unfocused. Reactive here so a test can blur and refocus it.
const focus = vi.hoisted(() => {
    let focused = true;
    const listeners = new Set<() => void>();
    return {
        get: () => focused,
        set: (next: boolean) => {
            focused = next;
            for (const listener of [...listeners]) listener();
        },
        subscribe: (listener: () => void) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
    };
});

vi.mock('@react-navigation/native', async () => {
    const React = await import('react');
    const { createReactNavigationNativeMock } = await import('@/dev/testkit/mocks/reactNavigation');
    return {
        ...createReactNavigationNativeMock(),
        useIsFocused: () => React.useSyncExternalStore(focus.subscribe, focus.get, focus.get),
    };
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
    let previous: ReturnType<typeof storage.getState>;
    beforeEach(() => {
        previous = storage.getState();
        storage.getState().setSocketStatus('connected');
    });
    afterEach(() => {
        storage.setState(previous, true);
    });

    it('groups live workers by issue, puts a working issue above idle No issue and leaves out archived ones', async () => {
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
        seedListOnly([session('s1', '/home/u/dev/wt/atr-6-a', { permissionMode: 'acceptEdits' } as Partial<Session>)]);
        const screen = await renderColumn();
        await pressTestInstanceAsync(findTestInstanceByTypeContainingText(screen.tree, 'Pressable', 'Details')!);
        const text = screen.getTextContent();
        expect(text).toContain('Title s1');
        expect(text).not.toContain('acceptEdits');
        expect(text).not.toContain('default');
        expect(screen.findByTestId('ip-worker-context-s1')).toBeNull();
    });

    it('offers Stop on a busy worker and the resume control on an inactive one', async () => {
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

    it('C1/C4: offers Stop for background and resuming work, but not failed or idle workers', async () => {
        const now = Date.now();
        seed([
            session('background', '/work/atr-6-background', { active: true, activeAt: now, runtimeActivityState: 'active', runtimeActivityActiveCount: 1, runtimeActivityObservedAt: now }),
            session('resuming', '/work/atr-6-resuming', { active: true, activeAt: now }),
            session('failed', '/work/atr-6-failed', { active: true, activeAt: now, latestTurnStatus: 'failed', latestTurnStatusObservedAt: now }),
            session('idle', '/work/atr-6-idle', { active: true, activeAt: now, thinking: false }),
        ]);
        // Resume is a client-owned lifecycle marker, not a field accepted from a server snapshot.
        act(() => storage.getState().markSessionResuming('resuming'));
        const screen = await renderColumn();
        await pressTestInstanceAsync(findTestInstanceByTypeContainingText(screen.tree, 'Pressable', 'Details')!);
        expect(screen.findByTestId('ip-stop-background')).not.toBeNull();
        expect(screen.findByTestId('ip-stop-resuming')).not.toBeNull();
        expect(screen.findByTestId('ip-stop-failed')).toBeNull();
        expect(screen.findByTestId('ip-stop-idle')).toBeNull();
    });

    it('ATR-37.3: mode and title updates preserve equal-urgency group order until a worker signal arrives', async () => {
        const now = Date.now();
        const older = session('older', '/work/atr-6-older', { active: true, activeAt: now - 20_000, updatedAt: now - 20_000 });
        const newer = session('newer', '/work/atr-7-newer', { active: true, activeAt: now - 10_000, updatedAt: now - 10_000 });
        seed([older, newer]);
        const screen = await renderColumn();
        const order = () => screen.findAll((node) => typeof node.type === 'string' &&
            typeof node.props.testID === 'string' && node.props.testID.startsWith('ip-issue-'))
            .map((node) => node.props.testID);
        expect(order()).toEqual(['ip-issue-ATR-7', 'ip-issue-ATR-6']);
        const edited = { ...older, seq: older.seq + 1, updatedAt: now, permissionMode: 'yolo' as const,
            metadataVersion: older.metadataVersion + 1,
            metadata: { ...older.metadata!, summary: { text: 'Renamed worker', updatedAt: now } },
        };
        seed([edited]);
        expect(storage.getState().sessions.older.permissionMode).toBe('yolo');
        expect(screen.getTextContent()).toContain('Renamed worker');
        expect(order()).toEqual(['ip-issue-ATR-7', 'ip-issue-ATR-6']);
        seed([{ ...edited, seq: edited.seq + 1, updatedAt: now + 1, activeAt: now }]);
        expect(order()).toEqual(['ip-issue-ATR-6', 'ip-issue-ATR-7']);
    });

    it('prefers the session branch over the folder name', async () => {
        seed([session('s2', '/home/u/dev')]);
        setBranch('s2', 'hub-59-store-skill');
        const screen = await renderColumn();
        expect(screen.getTextContent()).toContain('HUB-59');
        expect(screen.getTextContent()).not.toContain('No issue');
    });

    it('N3 two workers on one branch show under their own issues', async () => {
        const tagged = (id: string, tag: string) =>
            session(id, '/home/u/dev/app', {
                metadata: { path: '/home/u/dev/app', host: 'h', homeDir: '/home/u', machineId: 'm', summary: { text: `Title ${id}`, updatedAt: 1 }, tag } as Session['metadata'],
            });
        seed([tagged('w1', 'ATR-6-build'), tagged('w2', 'ATR-7-build')]);
        setBranch('w1', 'main');
        setBranch('w2', 'main');
        const screen = await renderColumn();
        const cards = screen.tree.root.findAll((node) => typeof node.props?.testID === 'string' && node.props.testID.startsWith('ip-issue-') && typeof node.type === 'string');
        expect(cards.map((node) => node.props.testID).sort()).toEqual(['ip-issue-ATR-6', 'ip-issue-ATR-7']);
    });

    it('N2 a branch that arrives after the column is drawn moves the worker under its issue', async () => {
        seed([session('s2', '/home/u/dev')]);
        const screen = await renderColumn();
        expect(screen.getTextContent()).toContain('No issue');
        setBranch('s2', 'hub-59-store-skill');
        expect(screen.getTextContent()).toContain('HUB-59');
        expect(screen.getTextContent()).not.toContain('No issue');
    });

    it('must not add a group for a branch update on an unlisted session', async () => {
        seed([session('s1', '/home/u/dev/wt/atr-6-a')]);
        const screen = await renderColumn();
        setBranch('other', 'hub-59-x');
        expect(screen.getTextContent()).not.toContain('HUB-59');
        expect(screen.findByTestId('ip-count-all')?.props.children).toBe(1);
    });
});

describe('WorkColumn freshness (F1)', () => {
    const t0 = Date.UTC(2026, 10, 1, 9, 0, 0);
    let previous: ReturnType<typeof storage.getState>;
    beforeEach(() => {
        previous = storage.getState();
        storage.getState().setSocketStatus('connected');
        vi.useFakeTimers();
        vi.setSystemTime(t0);
    });
    afterEach(() => {
        storage.setState(previous, true);
        vi.useRealTimers();
        focus.set(true);
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

    it('A3 a signal between two ticks goes stale within one desk tick of the budget', async () => {
        seed([thinking('w1', t0)]);
        const screen = await renderColumn();
        // The new signal lands 10 s after the clock started, off the phase of a slow clock's ticks.
        await tick(10_000);
        act(() => {
            seed([thinking('w1', t0 + 10_000, 2)]);
        });
        expect(count(screen, 'working')).toBe(1);
        await tick(STALE + DESK_TICK_MS);
        expect(count(screen, 'working')).toBe(0);
    });

    it('F1 the desk clock, not the wall clock at render time, judges freshness', async () => {
        seed([thinking('w1', t0)]);
        const screen = await renderColumn();
        await tick(STALE + DESK_TICK_MS);
        expect(count(screen, 'working')).toBe(0);
        // The wall clock says fresh again, and a branch update rebuilds the rows without a tick.
        vi.setSystemTime(t0);
        setBranch('w1', 'hub-59-x');
        expect(screen.findByTestId('ip-issue-HUB-59')).toBeTruthy();
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

    it('A6 the desk clock stops while another screen covers the desk, and catches up on return', async () => {
        const base = vi.getTimerCount();
        seed([thinking('w1', t0)]);
        const screen = await renderColumn();
        expect(vi.getTimerCount()).toBe(base + 1);

        act(() => focus.set(false));
        expect(vi.getTimerCount()).toBe(base);
        await tick(STALE + DESK_TICK_MS);
        // Nothing re-reads the time while the desk is covered.
        expect(count(screen, 'working')).toBe(1);

        act(() => focus.set(true));
        expect(vi.getTimerCount()).toBe(base + 1);
        expect(count(screen, 'working')).toBe(0);
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
