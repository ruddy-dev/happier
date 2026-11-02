import { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findTestInstanceByTypeContainingText, pressTestInstanceAsync, renderScreen } from '@/dev/testkit';
import { createMachineFixture } from '@/dev/testkit/fixtures/machineFixtures';
import { createRootLayoutFeaturesResponse } from '@/dev/testkit/fixtures/featureFixtures';
import { getServerFeaturesSnapshot, resetServerFeaturesClientForTests } from '@/sync/api/capabilities/serverFeaturesClient';
import { createSessionFixture } from '@/dev/testkit/fixtures/sessionFixtures';
import { flushHookEffects } from '@/dev/testkit/hooks/flushHookEffects';
import { SESSION_RUNTIME_STATUS_STALE_SIGNAL_MS as STALE } from '@/sync/domains/session/attention/deriveSessionRuntimePresentationState';
import { buildSessionListRenderableFromSession } from '@/sync/domains/session/listing/sessionListRenderable';
import { storage } from '@/sync/domains/state/storage';
import type { Session } from '@/sync/domains/state/storageTypes';

import { DESK_TICK_MS } from '../model/useDeskNow';
import { armedUsageLimitRecovery, usageLimitIssue } from '../testkit/usageLimitFixtures';

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

describe('Work model sprites', () => {
    it('uses the full record model, with applied model ahead of a pending selection', async () => {
        const { toWorkerRows } = await import('./WorkColumn');
        const selected = session('model-worker', '/work/atr-9', {
            modelMode: 'gpt-6.1-sol', modelModeUpdatedAt: 20,
            metadata: { ...createSessionFixture().metadata!, flavor: 'codex',
                sessionAppliedModelV1: { v: 1, provider: 'codex', modelId: 'gpt-6-astra', updatedAt: 10 } },
        });
        const rows = [buildSessionListRenderableFromSession(selected)];
        expect(toWorkerRows(rows, new Map(), new Map(), Date.now())[0].model).toBeNull();
        expect(toWorkerRows(rows, new Map([[selected.id, selected]]), new Map(), Date.now())[0].model).toBe('gpt-6-astra');
        const withoutApplied = { ...selected, metadata: { ...selected.metadata!, sessionAppliedModelV1: undefined } };
        expect(toWorkerRows(rows, new Map([[selected.id, withoutApplied]]), new Map(), Date.now())[0].model).toBe('gpt-6.1-sol');
    });
});

async function renderColumn() {
    const { WorkColumn } = await import('./WorkColumn');
    return renderScreen(<WorkColumn />);
}

describe('WorkColumn', () => {
    let previous: ReturnType<typeof storage.getState>;
    beforeEach(async () => {
        previous = storage.getState();
        storage.getState().setSocketStatus('connected');
        resetServerFeaturesClientForTests();
        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(createRootLayoutFeaturesResponse({
            features: { sessions: { enabled: true, usageLimitRecovery: { enabled: true } } },
        })), { status: 200, headers: { 'content-type': 'application/json' } })));
        await getServerFeaturesSnapshot({ force: true });
    });
    afterEach(() => {
        storage.setState(previous, true);
        vi.useRealTimers();
        vi.unstubAllGlobals();
        vi.unstubAllEnvs();
        resetServerFeaturesClientForTests();
    });

    it.each(['column', 'row'] as const)('updates an unloaded %s rail face to its full-record model at 28 px', async (compact) => {
        const { WorkColumn } = await import('./WorkColumn');
        const { WorkerSprite } = await import('./WorkerSprite');
        const worker = session('sprite-worker', '/work/atr-9-sprites', { modelMode: 'gpt-6.1-sol', modelModeUpdatedAt: 20 });
        seedListOnly([worker]);
        const screen = await renderScreen(<WorkColumn compact={compact} />);
        const face = (issue: string) => screen.findByTestId(`ip-rail-face-${issue}`)!.findByType(WorkerSprite.type);
        expect(face('none').props).toMatchObject({ kind: 'ipdroid', size: 28 });
        seed([worker]);
        expect(face('ATR-9').props).toMatchObject({ kind: 'cxloupe', size: 28 });
    });

    it('finding 6: disabling recovery removes the armed claim but keeps the limit line', async () => {
        const now = Date.now();
        const issue = usageLimitIssue(now);
        seed([session('limited', '/work/atr-7-limited', {
            active: false, latestTurnStatus: 'failed', latestTurnStatusObservedAt: now, lastRuntimeIssue: issue,
            metadata: { ...createSessionFixture().metadata!, path: '/work/atr-7-limited', sessionUsageLimitRecoveryV1: armedUsageLimitRecovery(issue) },
        })]);
        const screen = await renderColumn();
        await pressTestInstanceAsync(findTestInstanceByTypeContainingText(screen.tree, 'Pressable', 'Details')!);
        expect(screen.getTextContent()).toContain('auto-resume armed');
        vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(createRootLayoutFeaturesResponse({
            features: { sessions: { enabled: true, usageLimitRecovery: { enabled: false } } },
        })), { status: 200, headers: { 'content-type': 'application/json' } }));
        await act(async () => { await getServerFeaturesSnapshot({ force: true }); });
        expect(screen.findByTestId('ip-worker-usage-limit-limited')).not.toBeNull();
        expect(screen.getTextContent()).not.toContain('auto-resume armed');
    });

    it.each(['today', 'tomorrow', 'past'] as const)('finding 4: formats a %s reset using the local desk clock', async (when) => {
        vi.useFakeTimers();
        const now = new Date(2026, 10, 2, 12, 0).getTime();
        vi.setSystemTime(now);
        const reset = new Date(2026, 10, when === 'tomorrow' ? 3 : 2, when === 'past' ? 11 : 14, 0);
        seed([session('limited', '/work/atr-7-limited', {
            active: false, latestTurnStatus: 'failed', latestTurnStatusObservedAt: now,
            lastRuntimeIssue: usageLimitIssue(now, reset.getTime()),
        })]);
        const screen = await renderColumn();
        await pressTestInstanceAsync(findTestInstanceByTypeContainingText(screen.tree, 'Pressable', 'Details')!);
        const time = reset.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
        const expected = when === 'past' ? 'Usage limit: reset due'
            : `Usage limit: waits for reset, ${when === 'tomorrow' ? `${reset.toLocaleDateString(undefined, { weekday: 'short' })}, ` : ''}${time}`;
        expect(screen.getTextContent()).toContain(expected);
        if (when === 'past') expect(screen.getTextContent()).not.toContain('waits for reset');
    });

    it('finding 4: a current limit changes to reset due on the shared clock tick', async () => {
        vi.useFakeTimers();
        const now = new Date(2026, 10, 2, 12, 0).getTime();
        vi.setSystemTime(now);
        seed([session('limited', '/work/atr-7-limited', {
            active: false, latestTurnStatus: 'failed', latestTurnStatusObservedAt: now,
            lastRuntimeIssue: usageLimitIssue(now, now + DESK_TICK_MS),
        })]);
        const screen = await renderColumn();
        await pressTestInstanceAsync(findTestInstanceByTypeContainingText(screen.tree, 'Pressable', 'Details')!);
        expect(screen.getTextContent()).toContain('waits for reset');
        await flushHookEffects({ advanceTimersMs: DESK_TICK_MS, cycles: 1 });
        expect(screen.getTextContent()).toContain('Usage limit: reset due');
        expect(screen.getTextContent()).not.toContain('waits for reset');
    });

    it('finding 5: a permission and limit on the same worker keep its issue in Turn', async () => {
        const now = Date.now();
        seed([
            session('limited', '/work/atr-7-limited', {
                active: true, activeAt: now, latestTurnStatus: 'failed', latestTurnStatusObservedAt: now,
                lastRuntimeIssue: usageLimitIssue(now),
                agentState: { requests: { request: { tool: 'Bash', arguments: { command: 'pwd' }, createdAt: now } } },
            }),
            session('busy', '/work/atr-6-busy', { active: true, thinking: true, thinkingAt: now }),
        ]);
        const screen = await renderColumn();
        await pressTestInstanceAsync(findTestInstanceByTypeContainingText(screen.tree, 'Pressable', 'Details')!);
        const card = screen.findByTestId('ip-issue-ATR-7')!;
        expect(card.findAll((node) => node.props.testID === 'ip-bulb-dot-turn').length).toBeGreaterThan(0);
        expect(card.findAll((node) => node.props.testID === 'ip-bulb-dot-waiting')).toHaveLength(0);
        expect(screen.findByTestId('ip-worker-usage-limit-limited')).not.toBeNull();
        expect(screen.findByTestId('ip-count-turn')?.props.children).toBe(1);
        expect(screen.findByTestId('ip-count-waiting')?.props.children).toBe(0);
        expect(screen.findAll((node) => typeof node.type === 'string' &&
            typeof node.props.testID === 'string' && node.props.testID.startsWith('ip-issue-'))
            .map((node) => node.props.testID)).toEqual(['ip-issue-ATR-7', 'ip-issue-ATR-6']);
    });

    it.each([false, true])('finding 3: a current limit is Waiting until the worker is busy=%s', async (busy) => {
        const now = Date.now();
        seed([session('limited', '/work/atr-7-limited', {
            active: true, activeAt: now, thinking: busy, thinkingAt: now,
            latestTurnStatus: busy ? 'in_progress' : 'failed', latestTurnStatusObservedAt: now,
            lastRuntimeIssue: usageLimitIssue(now),
        })]);
        const screen = await renderColumn();
        await pressTestInstanceAsync(findTestInstanceByTypeContainingText(screen.tree, 'Pressable', 'Details')!);
        expect(screen.findByTestId(`ip-count-${busy ? 'working' : 'waiting'}`)?.props.children).toBe(1);
        expect(screen.findByTestId(`ip-count-${busy ? 'waiting' : 'working'}`)?.props.children).toBe(0);
        expect(screen.findByTestId('ip-worker-usage-limit-limited')).not.toBeNull();
    });

    it.each([true, false])('F5: a limited worker stays waiting while active=%s, below a permission request', async (active) => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2026, 10, 3, 12, 0));
        const now = Date.now();
        const reset = new Date(2026, 10, 3, 14, 0).getTime();
        const limited = session('limited', '/work/atr-7-limited', {
            active, activeAt: now, latestTurnStatus: 'failed', latestTurnStatusObservedAt: now,
            lastRuntimeIssue: usageLimitIssue(now, reset),
        });
        const permission = session('permission', '/work/atr-6-permission', {
            active: true, activeAt: now,
            agentState: { requests: { request: { tool: 'Bash', arguments: { command: 'pwd' }, createdAt: now } } },
        });
        seed([limited, permission]);
        const screen = await renderColumn();
        await pressTestInstanceAsync(findTestInstanceByTypeContainingText(screen.tree, 'Pressable', 'Details')!);
        expect(screen.getTextContent()).toContain(`Usage limit: waits for reset, ${new Date(reset).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`);
        const card = screen.findByTestId('ip-issue-ATR-7')!;
        expect(card.findAll((node) => node.props.testID === 'ip-bulb-dot-waiting').length).toBeGreaterThan(0);
        expect(card.findAll((node) => node.props.testID === 'ip-bulb-dot-idle' || node.props.testID === 'ip-bulb-dot-stuck')).toHaveLength(0);
        const order = screen.findAll((node) => typeof node.type === 'string' &&
            typeof node.props.testID === 'string' && node.props.testID.startsWith('ip-issue-'))
            .map((node) => node.props.testID);
        expect(order).toEqual(['ip-issue-ATR-6', 'ip-issue-ATR-7']);
        expect(screen.findByTestId('ip-count-waiting')?.props.children).toBe(1);
        expect(screen.findByTestId('ip-count-idle')?.props.children).toBe(0);
    });

    it('F5: a list-only limit is visible before recovery metadata loads', async () => {
        const now = Date.now();
        seedListOnly([session('limited', '/work/atr-7-limited', {
            active: false, latestTurnStatus: 'failed', latestTurnStatusObservedAt: now,
            lastRuntimeIssue: usageLimitIssue(now),
        })]);
        const screen = await renderColumn();
        await pressTestInstanceAsync(findTestInstanceByTypeContainingText(screen.tree, 'Pressable', 'Details')!);
        expect(screen.getTextContent()).toContain('Usage limit: waits for reset');
        expect(screen.getTextContent()).not.toContain('auto-resume armed');
        expect(screen.findByTestId('ip-count-waiting')?.props.children).toBe(1);
        expect(screen.findByTestId('ip-count-idle')?.props.children).toBe(0);
    });

    it('F5: loaded auto-resume is explained, then a successful turn removes the line', async () => {
        const now = Date.now();
        const issue = usageLimitIssue(now);
        const limited = session('limited', '/work/atr-7-limited', {
            active: false, latestTurnStatus: 'failed', latestTurnStatusObservedAt: now, lastRuntimeIssue: issue,
            metadata: { ...createSessionFixture().metadata!, path: '/work/atr-7-limited', sessionUsageLimitRecoveryV1: armedUsageLimitRecovery(issue) },
        });
        seed([limited]);
        const screen = await renderColumn();
        await pressTestInstanceAsync(findTestInstanceByTypeContainingText(screen.tree, 'Pressable', 'Details')!);
        expect(screen.getTextContent()).toContain('Usage limit: waits for reset; auto-resume armed');
        seed([{ ...limited, seq: limited.seq + 1, updatedAt: now + 10_000, latestTurnStatus: 'completed', latestTurnStatusObservedAt: now + 10_000, meaningfulActivityAt: now + 10_000 }]);
        expect(screen.findByTestId('ip-worker-usage-limit-limited')).toBeNull();
        expect(screen.findByTestId('ip-count-waiting')?.props.children).toBe(0);
    });

    it.each([[95_500, 43], [197_800, 90], [220_000, 100], [242_000, 110]])(
        'Finding 4 displays the canonical context percentage for %i tokens', async (used, percent) => {
            vi.stubEnv('EXPO_PUBLIC_IP_AUTOCOMPACT_CLAUDE', '220000');
            seed([session('worker-context', '/workspace/project', { latestUsage: {
                inputTokens: 0, outputTokens: 0, cacheCreation: 0, cacheRead: 0,
                contextSize: used, contextSizeIsReported: true, contextWindowTokens: 1_000_000, timestamp: 1,
            } })]);
            const screen = await renderColumn();
            await pressTestInstanceAsync(findTestInstanceByTypeContainingText(screen.tree, 'Pressable', 'Details')!);
            expect(screen.findByTestId('ip-worker-context-worker-context')?.props.children).toEqual([percent, '%']);
        },
    );

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

    it('ATR-37.3: mode, title and keep-alive updates preserve group order until worker activity arrives', async () => {
        const now = Date.now();
        const older = session('older', '/work/atr-6-older', { active: true, activeAt: now - 20_000, runtimeActivityObservedAt: now - 20_000, updatedAt: now - 20_000 });
        const newer = session('newer', '/work/atr-7-newer', { active: true, activeAt: now - 10_000, runtimeActivityObservedAt: now - 10_000, updatedAt: now - 10_000 });
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
        const heartbeat = { ...edited, seq: edited.seq + 1, activeAt: now };
        seed([heartbeat]);
        expect(storage.getState().sessions.older.activeAt).toBe(now);
        expect(order()).toEqual(['ip-issue-ATR-7', 'ip-issue-ATR-6']);
        seed([{ ...heartbeat, seq: heartbeat.seq + 1, runtimeActivityObservedAt: now }]);
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
