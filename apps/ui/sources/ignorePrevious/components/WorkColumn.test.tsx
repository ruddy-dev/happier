import { act } from 'react-test-renderer';
import { Platform } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDeferred, findTestInstanceByTypeContainingText, pressTestInstanceAsync, renderScreen } from '@/dev/testkit';
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
import { resetWorkCardCacheForTests } from '../model/useWorkCardData';
import type { SessionReadFileResponse } from '@/sync/ops/sessionFileSystem/fileReadWrite';
import { encodeBase64 } from '@/encryption/base64';
import { getStoredCoordinatorId, setStoredCoordinatorId } from '../deskPrefs';
import { armedUsageLimitRecovery, usageLimitIssue } from '../testkit/usageLimitFixtures';
import { apiSocket } from '@/sync/api/session/apiSocket';
import { upsertAndActivateServer } from '@/sync/domains/server/serverRuntime';
import { projectManager } from '@/sync/runtime/orchestration/projectManager';
import { prSnapshot } from '../testkit/prSnapshot';

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

const readWqFile = vi.hoisted(() => vi.fn<(sessionId: string, path: string) => Promise<SessionReadFileResponse>>());
vi.mock('@/sync/ops/sessionFileSystem/fileReadWrite', () => ({ sessionReadFile: readWqFile }));

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
        expect(face('none').props).toMatchObject({ kind: 'no-worker', size: 28 });
        seed([worker]);
        expect(face('ATR-9').props).toMatchObject({ kind: 'cxloupe', size: 28 });
    });

    it.each([undefined, 'column', 'row'] as const)('keeps the %s grouped face with its state owner and breaks ties by recency', async (compact) => {
        const { WorkColumn } = await import('./WorkColumn');
        const { WorkerSprite } = await import('./WorkerSprite');
        const now = Date.now();
        const request = { tool: 'Bash', arguments: { command: 'pwd' }, createdAt: now };
        const newer = session('newer', '/work/atr-9-sprites', {
            modelMode: 'claude-sonnet-5.5', updatedAt: now, meaningfulActivityAt: now,
            active: true, activeAt: now,
        });
        const older = session('older', '/work/atr-9-sprites', {
            modelMode: 'gpt-6.1-sol', updatedAt: now - 1000, meaningfulActivityAt: now - 1000,
            active: true, activeAt: now,
            agentState: { requests: { request } },
        });
        seed([newer, older]);
        const screen = await renderScreen(<WorkColumn compact={compact} />);
        const face = () => screen.findByTestId(compact ? 'ip-rail-face-ATR-9' : 'ip-work-card-face-ATR-9')!.findByType(WorkerSprite.type);
        expect(face().props).toMatchObject({ kind: 'cxloupe', bulb: 'turn', size: compact ? 28 : 40 });
        seed([{ ...newer, seq: newer.seq + 1, agentState: { requests: { request } } }]);
        expect(face().props).toMatchObject({ kind: 'ginger', bulb: 'turn' });
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


describe('N1/N4/F4 WorkColumn wq data', () => {
    let previous: ReturnType<typeof storage.getState>;
    let coordinator: string | null;
    const projects = JSON.stringify({
        ATR: { name: 'Desk Demo', path: '/fixture/a', github: 'example/a' },
        HUB: { name: 'Tools Demo', path: '/fixture/b', github: 'example/b' },
    });
    const item = (key = 'ATR-18', status = 'active') => `---\nid: ${key}\ntitle: Demo card title\nstatus: ${status}\n---\nPrivate body must not appear`;
    const response = (text: string): SessionReadFileResponse => ({ success: true, content: encodeBase64(new TextEncoder().encode(text)) });
    const reads = () => readWqFile.mock.calls.map(([id, path]) => [id, path]);
    beforeEach(() => {
        previous = storage.getState();
        coordinator = getStoredCoordinatorId();
        setStoredCoordinatorId('coord');
        storage.getState().setSocketStatus('connected');
        vi.stubEnv('EXPO_PUBLIC_IP_WQ_DIR', '/fixture/wq/');
        readWqFile.mockReset();
        readWqFile.mockImplementation(async (_id, path) => response(path.endsWith('projects.json') ? projects : item()));
        seed([session('coord', '/fixture/coordinator', { active: true }), session('worker', '/fixture/atr-18')]);
    });
    afterEach(() => {
        act(() => {
            storage.setState(previous, true);
            setStoredCoordinatorId(coordinator);
        });
        resetWorkCardCacheForTests();
        vi.unstubAllEnvs();
        vi.unstubAllGlobals();
        vi.useRealTimers();
        focus.set(true);
    });

    it('N1 shows the plain title, project and evidence stage and reads only the coordinator paths', async () => {
        const screen = await renderColumn();
        await flushHookEffects();
        expect(screen.getTextContent()).toContain('Demo card title');
        expect(screen.getTextContent()).toContain('Desk Demo');
        expect(screen.findByTestId('ip-work-stage-ATR-18')?.props.accessibilityLabel).toContain('Build');
        expect(screen.findByTestId('ip-issue-ATR-18')?.findAllByProps({ accessibilityRole: 'button' })[0].props.accessibilityLabel).toContain('Stage: Build');
        expect(screen.getTextContent()).not.toContain('Private body');
        expect(screen.getTextContent()).not.toContain('/fixture/a');
        expect(reads()).toEqual([['coord', '/fixture/wq/projects.json'], ['coord', '/fixture/wq/items/ATR-18.md']]);
    });

    it('F4 leaves the existing card intact until the reads resolve', async () => {
        const deferred = createDeferred<SessionReadFileResponse>();
        readWqFile.mockReturnValueOnce(deferred.promise);
        const screen = await renderColumn();
        expect(screen.findByTestId('ip-issue-ATR-18')).not.toBeNull();
        expect(screen.getTextContent()).toContain('Title worker');
        expect(screen.findByTestId('ip-work-stage-ATR-18')).toBeNull();
        expect(screen.getTextContent()).not.toContain('Desk Demo');
        await act(async () => deferred.resolve(response(projects)));
        await flushHookEffects();
        expect(screen.getTextContent()).toContain('Demo card title');
    });

    it('C N1 remount keeps the warm card without repeating either read', async () => {
        const first = await renderColumn();
        await flushHookEffects();
        expect(reads()).toHaveLength(2);
        await first.unmount();
        const remounted = await renderColumn();
        expect(remounted.getTextContent()).toContain('Demo card title');
        await flushHookEffects();
        expect(reads()).toEqual([['coord', '/fixture/wq/projects.json'], ['coord', '/fixture/wq/items/ATR-18.md']]);
    });

    it('C N1 remount shares a pending item read and receives its result', async () => {
        const pending = createDeferred<SessionReadFileResponse>();
        readWqFile.mockImplementation(async (_id, path) => path.endsWith('projects.json') ? response(projects) : pending.promise);
        const first = await renderColumn();
        await flushHookEffects();
        expect(reads()).toHaveLength(2);
        await first.unmount();
        const remounted = await renderColumn();
        try {
            await flushHookEffects();
            expect(reads()).toHaveLength(2);
            expect(remounted.getTextContent()).not.toContain('Demo card title');
        } finally {
            await act(async () => pending.resolve(response(item())));
        }
        await flushHookEffects();
        expect(reads()).toHaveLength(2);
        expect(remounted.getTextContent()).toContain('Demo card title');
    });

    it('C N1 inventory settling with no mounted hooks is retained without starting another read', async () => {
        const pending = createDeferred<SessionReadFileResponse>();
        readWqFile.mockReturnValueOnce(pending.promise);
        const first = await renderColumn();
        await first.unmount();
        await act(async () => pending.resolve(response(projects)));
        await flushHookEffects();
        expect(reads()).toEqual([['coord', '/fixture/wq/projects.json']]);
        const remounted = await renderColumn();
        await flushHookEffects();
        expect(reads()).toEqual([['coord', '/fixture/wq/projects.json'], ['coord', '/fixture/wq/items/ATR-18.md']]);
        expect(remounted.getTextContent()).toContain('Demo card title');
    });

    it('C F4 remount preserves the five-minute failed-item attempt window', async () => {
        vi.useFakeTimers();
        readWqFile.mockImplementation(async (_id, path) => path.endsWith('projects.json') ? response(projects) : { success: false, error: 'Missing file' });
        const first = await renderColumn();
        await flushHookEffects();
        expect(reads()).toHaveLength(2);
        await first.unmount();
        const remounted = await renderColumn();
        await flushHookEffects({ advanceTimersMs: 295_000, cycles: 1 });
        expect(reads()).toHaveLength(2);
        expect(remounted.getTextContent()).toContain('Title worker');
        await flushHookEffects({ advanceTimersMs: 5_000, cycles: 1 });
        expect(reads()).toEqual([['coord', '/fixture/wq/projects.json'], ['coord', '/fixture/wq/items/ATR-18.md'], ['coord', '/fixture/wq/items/ATR-18.md']]);
    });

    it('C N1 two mounted hooks share the inventory, item attempts and result', async () => {
        const pending = createDeferred<SessionReadFileResponse>();
        readWqFile.mockReturnValueOnce(pending.promise);
        const first = await renderColumn();
        const second = await renderColumn();
        try {
            expect(reads()).toEqual([['coord', '/fixture/wq/projects.json']]);
        } finally {
            await act(async () => pending.resolve(response(projects)));
        }
        await flushHookEffects();
        expect(reads()).toEqual([['coord', '/fixture/wq/projects.json'], ['coord', '/fixture/wq/items/ATR-18.md']]);
        expect(first.getTextContent()).toContain('Demo card title');
        expect(second.getTextContent()).toContain('Demo card title');
        await first.unmount();
        expect(second.getTextContent()).toContain('Demo card title');
    });

    it.each(['coordinator', 'directory'])('C F4 remount discards a pending old %s result and waits for its call to settle', async change => {
        const oldItem = createDeferred<SessionReadFileResponse>();
        const newInventory = createDeferred<SessionReadFileResponse>();
        readWqFile.mockResolvedValueOnce(response(projects)).mockReturnValueOnce(oldItem.promise).mockReturnValueOnce(newInventory.promise);
        const first = await renderColumn();
        await flushHookEffects();
        expect(reads()).toHaveLength(2);
        await first.unmount();
        if (change === 'coordinator') {
            seed([session('new-coord', '/fixture/another-coordinator', { active: true })]);
            act(() => setStoredCoordinatorId('new-coord'));
        } else vi.stubEnv('EXPO_PUBLIC_IP_WQ_DIR', '/fixture/other-wq');
        const remounted = await renderColumn();
        try {
            await flushHookEffects();
            expect(reads()).toHaveLength(2);
        } finally {
            await act(async () => oldItem.resolve(response(item().replace('Demo card title', 'Old card title'))));
            await flushHookEffects();
            expect(remounted.getTextContent()).not.toContain('Old card title');
            await act(async () => newInventory.resolve(response(projects)));
        }
        await flushHookEffects();
        const id = change === 'coordinator' ? 'new-coord' : 'coord';
        const dir = change === 'directory' ? '/fixture/other-wq' : '/fixture/wq';
        expect(reads()).toEqual([
            ['coord', '/fixture/wq/projects.json'], ['coord', '/fixture/wq/items/ATR-18.md'],
            [id, `${dir}/projects.json`], [id, `${dir}/items/ATR-18.md`],
        ]);
        expect(remounted.getTextContent()).toContain('Demo card title');
        expect(remounted.getTextContent()).not.toContain('Old card title');
    });

    it.each(['missing', 'size', 'parse', 'mismatch', 'throw'])('F4 a %s item failure leaves today’s card and waits five minutes', async failure => {
        vi.useFakeTimers();
        readWqFile.mockImplementation(async (_id, path) => {
            if (path.endsWith('projects.json')) return response(projects);
            if (failure === 'throw') throw new Error('boundary failure');
            if (failure === 'parse') return response('not front matter');
            if (failure === 'mismatch') return response(item('HUB-59'));
            return { success: false, error: failure === 'size' ? 'File exceeds the inline file read size limit' : 'Missing file' };
        });
        const screen = await renderColumn();
        await flushHookEffects();
        expect(screen.getTextContent()).not.toContain('Demo card title');
        expect(screen.getTextContent()).not.toContain('Desk Demo');
        expect(screen.getTextContent()).toContain('Title worker');
        await flushHookEffects({ advanceTimersMs: 295_000, cycles: 1 });
        expect(reads()).toHaveLength(2);
        await flushHookEffects({ advanceTimersMs: 5_000, cycles: 1 });
        expect(reads()).toEqual([['coord', '/fixture/wq/projects.json'], ['coord', '/fixture/wq/items/ATR-18.md'], ['coord', '/fixture/wq/items/ATR-18.md']]);
    });

    it('F4 no coordinator makes no reads even with an explicit wq directory', async () => {
        setStoredCoordinatorId(null);
        seed([session('coord', '/fixture/coordinator', { archivedAt: Date.now() })]);
        const screen = await renderColumn();
        await flushHookEffects();
        expect(reads()).toEqual([]);
        expect(screen.getTextContent()).not.toContain('Desk Demo');
    });

    it('F4 a failed inventory preserves unfiltered keys and only retries after five minutes', async () => {
        vi.useFakeTimers();
        setBranch('worker', 'fix-12-thing');
        readWqFile.mockResolvedValue({ success: false, error: 'Missing file' });
        const screen = await renderColumn();
        await flushHookEffects();
        expect(screen.findByTestId('ip-issue-FIX-12')).not.toBeNull();
        await flushHookEffects({ advanceTimersMs: 295_000, cycles: 1 });
        expect(reads()).toEqual([['coord', '/fixture/wq/projects.json']]);
        await flushHookEffects({ advanceTimersMs: 5_000, cycles: 1 });
        expect(reads()).toEqual([['coord', '/fixture/wq/projects.json'], ['coord', '/fixture/wq/projects.json']]);
    });

    it('F4 no configured directory makes no reads', async () => {
        vi.stubEnv('EXPO_PUBLIC_IP_WQ_DIR', '');
        await renderColumn();
        await flushHookEffects();
        expect(reads()).toEqual([]);
    });

    it('N1 serializes item reads while visible keys change', async () => {
        const first = createDeferred<SessionReadFileResponse>();
        readWqFile.mockImplementation(async (_id, path) => path.endsWith('projects.json') ? response(projects) :
            path.endsWith('ATR-18.md') ? first.promise : response(item('HUB-59')));
        await renderColumn();
        await flushHookEffects();
        seed([session('second', '/fixture/hub-59')]);
        await flushHookEffects();
        expect(reads()).toHaveLength(2);
        await act(async () => first.resolve(response(item())));
        await flushHookEffects();
        expect(reads()).toEqual([['coord', '/fixture/wq/projects.json'], ['coord', '/fixture/wq/items/ATR-18.md'], ['coord', '/fixture/wq/items/HUB-59.md']]);
    });

    it('F4 discards a previous coordinator’s pending result before reading the new coordinator', async () => {
        const oldInventory = createDeferred<SessionReadFileResponse>();
        readWqFile.mockReturnValueOnce(oldInventory.promise);
        const screen = await renderColumn();
        seed([session('new-coord', '/fixture/another-coordinator', { active: true })]);
        act(() => setStoredCoordinatorId('new-coord'));
        await flushHookEffects();
        expect(reads()).toEqual([['coord', '/fixture/wq/projects.json']]);
        await act(async () => oldInventory.resolve(response(JSON.stringify({ ATR: { name: 'Old inventory' } }))));
        await flushHookEffects();
        expect(reads()).toEqual([['coord', '/fixture/wq/projects.json'], ['new-coord', '/fixture/wq/projects.json'], ['new-coord', '/fixture/wq/items/ATR-18.md']]);
        expect(screen.getTextContent()).toContain('Desk Demo');
        expect(screen.getTextContent()).not.toContain('Old inventory');
    });

    it('F4 makes no reads while hidden and catches up in the foreground', async () => {
        vi.useFakeTimers();
        const platform = Object.getOwnPropertyDescriptor(Platform, 'OS')!;
        Object.defineProperty(Platform, 'OS', { configurable: true, value: 'web' });
        const host = Object.assign(new EventTarget(), { visibilityState: 'hidden' });
        vi.stubGlobal('document', host);
        try {
            const screen = await renderColumn();
            await flushHookEffects({ advanceTimersMs: 300_000, cycles: 1 });
            expect(reads()).toEqual([]);
            act(() => {
                host.visibilityState = 'visible';
                host.dispatchEvent(new Event('visibilitychange'));
            });
            await flushHookEffects();
            expect(reads()).toHaveLength(2);
            expect(screen.getTextContent()).toContain('Demo card title');
        } finally {
            Object.defineProperty(Platform, 'OS', platform);
        }
    });

    it('N4 filters false projects, retries the folder source and never requests unsafe keys', async () => {
        setBranch('worker', 'fix-12-thing');
        seed([session('unknown', '/fixture/ZZ-1'), session('long', '/fixture/atr-1234567')]);
        const screen = await renderColumn();
        await flushHookEffects();
        expect(screen.findByTestId('ip-issue-FIX-12')).toBeNull();
        expect(screen.findByTestId('ip-issue-ZZ-1')).toBeNull();
        expect(screen.findByTestId('ip-issue-ATR-18')).not.toBeNull();
        expect(reads()).toEqual([['coord', '/fixture/wq/projects.json'], ['coord', '/fixture/wq/items/ATR-18.md']]);
    });

    it('N1 caches successes, reads newly visible keys and pauses refresh while unfocused', async () => {
        vi.useFakeTimers();
        readWqFile.mockImplementation(async (_id, path) => response(path.endsWith('projects.json') ? projects : item(path.includes('HUB-59') ? 'HUB-59' : 'ATR-18')));
        const screen = await renderColumn();
        await flushHookEffects();
        await flushHookEffects({ advanceTimersMs: 295_000, cycles: 1 });
        expect(reads()).toHaveLength(2);
        seed([session('second', '/fixture/hub-59')]);
        await flushHookEffects();
        expect(reads()).toHaveLength(3);
        act(() => focus.set(false));
        await flushHookEffects({ advanceTimersMs: 300_000, cycles: 1 });
        expect(reads()).toHaveLength(3);
        act(() => focus.set(true));
        await flushHookEffects();
        expect(reads()).toHaveLength(5);
        expect(readWqFile.mock.calls.filter(([, path]) => path.endsWith('projects.json'))).toHaveLength(1);
        expect(screen.getTextContent()).toContain('Demo card title');
    });

    it.each([['ready', 'Plan'], ['review', 'PR'], ['done', 'Merged'], ['blocked', 'Blocked'], ['needs-luke', 'Needs you'], ['dropped', null], ['other', null]])('N1 renders %s with only its evidenced label', async (status, label) => {
        readWqFile.mockImplementation(async (_id, path) => response(path.endsWith('projects.json') ? projects : item('ATR-18', status)));
        const screen = await renderColumn();
        await flushHookEffects();
        expect(screen.getTextContent()).toContain('Demo card title');
        if (status === 'blocked' || status === 'needs-luke') {
            expect(screen.findByTestId('ip-work-stage-ATR-18')).toBeNull();
            expect(screen.getTextContent()).toContain(label);
        } else if (label) {
            expect(screen.findByTestId('ip-work-stage-ATR-18')?.props.accessibilityLabel).toContain(label);
        } else expect(screen.findByTestId('ip-work-stage-ATR-18')).toBeNull();
    });
});

describe('L4/N issue Archive on the real store', () => {
    let previous: ReturnType<typeof storage.getState>;
    let coordinator: string | null;
    const archivedAt = 1_800_000_000_000;
    const response = vi.fn<(path: string) => Promise<Response>>();

    function merged(id: string, state: 'merged' | 'open' | 'unknown' | 'closed' = 'merged', age: 'fresh' | 'old' | 'missing' | 'invalid' = 'fresh') {
        const snapshot = prSnapshot({ fetchedAt: age === 'old' ? Date.now() - 660_000 : age === 'invalid' ? NaN : Date.now() });
        if (age === 'missing') Reflect.deleteProperty(snapshot, 'fetchedAt');
        snapshot.pullRequest = { ...snapshot.pullRequest!, state };
        act(() => {
            // The real store ignores fetchedAt-only updates. Reset the snapshot to exercise
            // incoming legacy/old evidence rather than accidentally retaining the fresh one.
            storage.getState().updateSessionProjectScmSnapshot(id, null);
            storage.getState().updateSessionProjectScmSnapshot(id, snapshot);
        });
    }

    async function openIssue() {
        const screen = await renderColumn();
        await pressTestInstanceAsync(findTestInstanceByTypeContainingText(screen.tree, 'Pressable', 'Details')!);
        return screen;
    }

    beforeEach(() => {
        previous = storage.getState();
        coordinator = getStoredCoordinatorId();
        upsertAndActivateServer({ serverUrl: 'http://localhost:53289', scope: 'tab' });
        projectManager.clear();
        storage.setState(storage.getInitialState(), true);
        setStoredCoordinatorId('coord');
        vi.stubEnv('EXPO_PUBLIC_IP_WQ_DIR', '');
        response.mockReset();
        response.mockImplementation(async () => new Response(JSON.stringify({ success: true, archivedAt })));
        // HTTP is the only archive boundary. The direct archive operation, pending guard and
        // store patch all run unchanged, so this also catches accidental stop/RPC dispatch.
        function request(path: string, init?: RequestInit): Promise<Response>;
        function request<T>(path: string, init: RequestInit | undefined, consume: (result: Response) => Promise<T>): Promise<T>;
        async function request<T>(path: string, _init?: RequestInit, consume?: (result: Response) => Promise<T>): Promise<Response | T> {
            const result = await response(path);
            return consume ? consume(result) : result;
        }
        vi.spyOn(apiSocket, 'request').mockImplementation(request);
        vi.spyOn(apiSocket, 'sessionRPC').mockRejectedValue(new Error('Archive must never stop a worker'));
    });

    afterEach(() => {
        act(() => {
            storage.setState(previous, true);
            setStoredCoordinatorId(coordinator);
        });
        vi.restoreAllMocks();
        vi.unstubAllEnvs();
        projectManager.clear();
    });

    it('Round 3: keeps the stopped carrier while a running worker remains, then retries without new evidence', async () => {
        const running = session('running', '/fixture/atr-6-running', { active: true, activeAt: Date.now() });
        seed([
            session('coord', '/fixture/atr-6-coord'), running,
            session('carrier', '/fixture/atr-6-carrier'), session('stopped', '/fixture/atr-6-stopped'),
        ]);
        merged('carrier');
        const screen = await openIssue();
        expect(response).not.toHaveBeenCalled();
        await pressTestInstanceAsync(screen.findByTestId('ip-issue-archive-ATR-6')!);
        expect(response.mock.calls.map(([path]) => path)).toEqual(['/v2/sessions/stopped/archive']);
        expect(apiSocket.sessionRPC).not.toHaveBeenCalled();
        expect(storage.getState().sessions.running.archivedAt).toBeFalsy();
        expect(storage.getState().sessions.carrier.archivedAt).toBeFalsy();
        expect(storage.getState().sessions.stopped.archivedAt).toBe(archivedAt);
        expect(storage.getState().sessions.coord.archivedAt).toBeFalsy();
        expect(screen.findByTestId('ip-issue-ATR-6')).not.toBeNull();
        expect(screen.findByTestId('ip-issue-archive-error-ATR-6')).toBeNull();
        seed([{ ...running, seq: 2, updatedAt: Date.now(), active: false }]);
        expect(screen.findByTestId('ip-issue-archive-ATR-6')).not.toBeNull();
        await pressTestInstanceAsync(screen.findByTestId('ip-issue-archive-ATR-6')!);
        expect(response.mock.calls.map(([path]) => path)).toEqual([
            '/v2/sessions/stopped/archive', '/v2/sessions/running/archive', '/v2/sessions/carrier/archive',
        ]);
        expect(screen.findByTestId('ip-issue-ATR-6')).toBeNull();
        expect(screen.findByTestId('ip-count-all')?.props.children).toBe(0);
    });

    it('Round 3: unchanged merged snapshot republished after ten minutes still shows Archive and dispatches', async () => {
        seed([session('carrier', '/fixture/atr-6-carrier')]);
        const snapshot = prSnapshot({ fetchedAt: Date.now() - 660_000 });
        snapshot.pullRequest = { ...snapshot.pullRequest!, state: 'merged' };
        act(() => storage.getState().updateSessionProjectScmSnapshot('carrier', snapshot));
        const screen = await openIssue();
        const refreshed = { ...snapshot, fetchedAt: Date.now() };
        act(() => storage.getState().updateSessionProjectScmSnapshot('carrier', refreshed));
        // Exercise the real store's timestamp-only suppression without clearing its snapshot.
        expect(storage.getState().getSessionProjectScmSnapshot('carrier')?.fetchedAt).toBe(snapshot.fetchedAt);
        expect(screen.findByTestId('ip-issue-archive-ATR-6')).not.toBeNull();
        await pressTestInstanceAsync(screen.findByTestId('ip-issue-archive-ATR-6')!);
        expect(storage.getState().sessions.carrier.archivedAt).toBe(archivedAt);
        expect(screen.findByTestId('ip-issue-ATR-6')).toBeNull();
    });

    it.each(['stopped', 'idle-active', 'failed'] as const)('Round 3: %s worker joining mid-operation stops carrier dispatch', async kind => {
        seed([session('carrier', '/fixture/atr-6-carrier'), session('first', '/fixture/atr-6-first')]);
        merged('carrier');
        const deferred = createDeferred<Response>();
        response.mockReturnValueOnce(deferred.promise);
        const screen = await openIssue();
        let pending: Promise<unknown> = Promise.resolve();
        await act(async () => { pending = screen.findByTestId('ip-issue-archive-ATR-6')!.props.onPress(); });
        seed([session('joined', '/fixture/atr-6-joined', {
            active: kind !== 'stopped', activeAt: Date.now(),
            ...(kind === 'failed' ? { latestTurnStatus: 'failed', latestTurnStatusObservedAt: Date.now() } : {}),
        })]);
        await act(async () => {
            deferred.resolve(new Response(JSON.stringify({ success: true, archivedAt })));
            await pending;
        });
        expect(response.mock.calls.map(([path]) => path)).toEqual(['/v2/sessions/first/archive']);
        expect(storage.getState().sessions.carrier.archivedAt).toBeFalsy();
        expect(storage.getState().sessions.joined.archivedAt).toBeFalsy();
        expect(screen.findByTestId('ip-issue-ATR-6')).not.toBeNull();
        expect(screen.findByTestId('ip-issue-archive-ATR-6')).not.toBeNull();
        expect(screen.findByTestId('ip-issue-archive-error-ATR-6')).toBeNull();
        seed([{ ...storage.getState().sessions.joined, seq: 2, updatedAt: Date.now(), active: false }]);
        await pressTestInstanceAsync(screen.findByTestId('ip-issue-archive-ATR-6')!);
        expect(response.mock.calls.map(([path]) => path)).toEqual([
            '/v2/sessions/first/archive', '/v2/sessions/joined/archive', '/v2/sessions/carrier/archive',
        ]);
        expect(screen.findByTestId('ip-issue-ATR-6')).toBeNull();
    });

    it('Round 3: rechecks live membership again between two carrier dispatches', async () => {
        seed([
            session('first-carrier', '/fixture/atr-6-first', { updatedAt: 20 }),
            session('last-carrier', '/fixture/atr-6-last'),
        ]);
        merged('first-carrier');
        merged('last-carrier');
        const deferred = createDeferred<Response>();
        response.mockReturnValueOnce(deferred.promise);
        const screen = await openIssue();
        let pending: Promise<unknown> = Promise.resolve();
        await act(async () => { pending = screen.findByTestId('ip-issue-archive-ATR-6')!.props.onPress(); });
        seed([session('joined', '/fixture/atr-6-joined')]);
        await act(async () => {
            deferred.resolve(new Response(JSON.stringify({ success: true, archivedAt })));
            await pending;
        });
        expect(response.mock.calls.map(([path]) => path)).toEqual(['/v2/sessions/first-carrier/archive']);
        expect(storage.getState().sessions['first-carrier'].archivedAt).toBe(archivedAt);
        expect(storage.getState().sessions['last-carrier'].archivedAt).toBeFalsy();
        expect(storage.getState().sessions.joined.archivedAt).toBeFalsy();
        expect(screen.findByTestId('ip-issue-archive-ATR-6')).not.toBeNull();
        await pressTestInstanceAsync(screen.findByTestId('ip-issue-archive-ATR-6')!);
        expect(response.mock.calls.map(([path]) => path)).toEqual([
            '/v2/sessions/first-carrier/archive', '/v2/sessions/joined/archive', '/v2/sessions/last-carrier/archive',
        ]);
        expect(screen.findByTestId('ip-issue-ATR-6')).toBeNull();
    });

    it('L4: partial failure names the failed worker, keeps Work and allows retry', async () => {
        seed([session('good', '/fixture/atr-6-good'), session('failed', '/fixture/atr-6-failed')]);
        merged('good');
        response.mockImplementation(async path => new Response(JSON.stringify(path.includes('/failed/')
            ? { error: 'unavailable' } : { success: true, archivedAt }), { status: path.includes('/failed/') ? 503 : 200 }));
        const screen = await openIssue();
        await pressTestInstanceAsync(screen.findByTestId('ip-issue-archive-ATR-6')!);
        expect(storage.getState().sessions.good.archivedAt).toBeFalsy();
        expect(storage.getState().sessions.failed.archivedAt).toBeFalsy();
        expect(screen.findByTestId('ip-issue-ATR-6')).not.toBeNull();
        expect(screen.findByTestId('ip-issue-archive-error-ATR-6')).not.toBeNull();
        expect(screen.getTextContent()).toContain('Title failed');
        response.mockResolvedValueOnce(new Response(JSON.stringify({ success: true, archivedAt })));
        await pressTestInstanceAsync(screen.findByTestId('ip-issue-archive-ATR-6')!);
        expect(screen.findByTestId('ip-issue-ATR-6')).toBeNull();
    });

    it('L4: busy state disables repeated presses and rechecks inactivity before the next archive', async () => {
        const first = session('first', '/fixture/atr-6-first', { updatedAt: 20 });
        const second = session('second', '/fixture/atr-6-second');
        seed([first, second]);
        merged('second');
        const deferred = createDeferred<Response>();
        response.mockReturnValueOnce(deferred.promise);
        const screen = await openIssue();
        const archive = screen.findByTestId('ip-issue-archive-ATR-6')!;
        let pending: Promise<unknown>;
        await act(async () => { pending = archive.props.onPress(); });
        expect(screen.findByTestId('ip-issue-archive-ATR-6')?.props.accessibilityState).toMatchObject({ busy: true, disabled: true });
        await act(async () => { await archive.props.onPress(); });
        expect(response).toHaveBeenCalledTimes(1);
        seed([{ ...second, seq: 2, updatedAt: Date.now(), active: true, activeAt: Date.now() }]);
        await act(async () => {
            deferred.resolve(new Response(JSON.stringify({ success: true, archivedAt })));
            await pending!;
        });
        expect(response.mock.calls.map(([path]) => path)).toEqual(['/v2/sessions/first/archive']);
        expect(storage.getState().sessions.second.archivedAt).toBeFalsy();
        expect(screen.findByTestId('ip-issue-ATR-6')).not.toBeNull();
    });

    it.each(['fresh', 'old', 'missing', 'invalid'] as const)('Round 3: %s merged evidence never expires for display or dispatch', async age => {
        seed([session('carrier', '/fixture/atr-6')]);
        merged('carrier');
        const screen = await openIssue();
        const archive = screen.findByTestId('ip-issue-archive-ATR-6')!;
        expect(archive).not.toBeNull();
        const archivePress = archive.props.onPress;
        merged('carrier', 'merged', age);
        expect(Boolean(screen.findByTestId('ip-issue-archive-ATR-6'))).toBe(true);
        // A captured callback must also accept merged evidence regardless of its age.
        await act(async () => { await archivePress(); });
        expect(storage.getState().sessions.carrier.archivedAt).toBe(archivedAt);
    });

    it.each(['old', 'missing', 'invalid', 'open', 'unknown'] as const)('Round 2 dispatch recheck refuses changed PR evidence: %s', async kind => {
        seed([session('carrier', '/fixture/atr-6-carrier'), session('sibling', '/fixture/atr-6-sibling')]);
        merged('carrier');
        const screen = await openIssue();
        const archive = screen.findByTestId('ip-issue-archive-ATR-6')!;
        const archivePress = archive.props.onPress;
        if (kind === 'open' || kind === 'unknown') merged('sibling', kind);
        else merged('sibling', 'closed', kind);
        await act(async () => { await archivePress(); });
        expect(response).not.toHaveBeenCalled();
        expect(storage.getState().sessions.carrier.archivedAt).toBeFalsy();
    });

    it.each(['open', 'unknown', 'stale', 'undated', 'invalid', 'no-pr', 'no-pr-snapshot', 'merged', 'closed'] as const)('Round 2 mixed PRs: merged plus %s', async kind => {
        seed([session('carrier', '/fixture/atr-6-carrier'), session('sibling', '/fixture/atr-6-sibling')]);
        merged('carrier');
        if (kind === 'no-pr-snapshot') {
            act(() => storage.getState().updateSessionProjectScmSnapshot('sibling', prSnapshot({ fetchedAt: Date.now(), pullRequest: null })));
        } else if (kind !== 'no-pr') {
            merged('sibling', kind === 'stale' || kind === 'undated' || kind === 'invalid' ? 'closed' : kind,
                kind === 'stale' ? 'old' : kind === 'undated' ? 'missing' : kind === 'invalid' ? 'invalid' : 'fresh');
        }
        const screen = await openIssue();
        const allowed = kind === 'no-pr' || kind === 'no-pr-snapshot' || kind === 'merged' || kind === 'closed';
        expect(Boolean(screen.findByTestId('ip-issue-archive-ATR-6'))).toBe(allowed);
        if (allowed) {
            await pressTestInstanceAsync(screen.findByTestId('ip-issue-archive-ATR-6')!);
            expect(storage.getState().sessions.carrier.archivedAt).toBe(archivedAt);
            expect(storage.getState().sessions.sibling.archivedAt).toBe(archivedAt);
            expect(screen.findByTestId('ip-issue-ATR-6')).toBeNull();
        } else expect(response).not.toHaveBeenCalled();
    });

    it.each(['old', 'open'] as const)('Round 2 rechecks PR evidence before the next dispatch: %s', async kind => {
        seed([session('first', '/fixture/atr-6-first', { updatedAt: 20 }), session('carrier', '/fixture/atr-6-carrier'), session('sibling', '/fixture/atr-6-sibling')]);
        merged('carrier');
        const deferred = createDeferred<Response>();
        response.mockReturnValueOnce(deferred.promise);
        const screen = await openIssue();
        let pending: Promise<unknown> = Promise.resolve();
        await act(async () => { pending = screen.findByTestId('ip-issue-archive-ATR-6')!.props.onPress(); });
        if (kind === 'old') merged('sibling', 'closed', 'old');
        else merged('carrier', 'open');
        await act(async () => {
            deferred.resolve(new Response(JSON.stringify({ success: true, archivedAt })));
            await pending;
        });
        expect(response.mock.calls.map(([path]) => path)).toEqual(['/v2/sessions/first/archive']);
        expect(storage.getState().sessions.carrier.archivedAt).toBeFalsy();
        expect(screen.findByTestId('ip-issue-archive-error-ATR-6')).not.toBeNull();
    });

    it('Round 2 cold restart: failure stops before evidence carriers and reload without archived rows can retry', async () => {
        seed([
            session('carrier', '/fixture/atr-6-carrier', { updatedAt: 30 }),
            session('done', '/fixture/atr-6-done', { updatedAt: 20 }),
            session('failed', '/fixture/atr-6-failed'),
        ]);
        merged('carrier');
        response.mockImplementation(async path => new Response(JSON.stringify(path.includes('/failed/')
            ? { error: 'unavailable' } : { success: true, archivedAt }), { status: path.includes('/failed/') ? 503 : 200 }));
        let screen = await openIssue();
        await pressTestInstanceAsync(screen.findByTestId('ip-issue-archive-ATR-6')!);
        expect(response.mock.calls.map(([path]) => path)).toEqual(['/v2/sessions/done/archive', '/v2/sessions/failed/archive']);
        expect(storage.getState().sessions.carrier.archivedAt).toBeFalsy();
        expect(storage.getState().sessions.done.archivedAt).toBe(archivedAt);
        const surviving = Object.values(storage.getState().sessions).filter(row => !row.archivedAt);
        await screen.unmount();
        act(() => storage.setState(storage.getInitialState(), true));
        projectManager.clear();
        seed(surviving);
        screen = await openIssue();
        expect(screen.findByTestId('ip-issue-archive-ATR-6')).toBeNull();
        // SCM is memory-only too: restore only a fresh snapshot on the surviving live carrier.
        merged('carrier');
        expect(storage.getState().sessions.done).toBeUndefined();
        expect(screen.findByTestId('ip-issue-archive-ATR-6')).not.toBeNull();
        response.mockReset();
        response.mockImplementation(async () => new Response(JSON.stringify({ success: true, archivedAt })));
        await pressTestInstanceAsync(screen.findByTestId('ip-issue-archive-ATR-6')!);
        expect(response.mock.calls.map(([path]) => path)).toEqual(['/v2/sessions/failed/archive', '/v2/sessions/carrier/archive']);
        expect(screen.findByTestId('ip-issue-ATR-6')).toBeNull();
    });

    it('Round 2 missing archive timestamp is a failure and leaves the evidence carrier live', async () => {
        seed([session('carrier', '/fixture/atr-6-carrier'), session('worker', '/fixture/atr-6-worker', { updatedAt: 20 })]);
        merged('carrier');
        response.mockImplementation(async () => new Response(JSON.stringify({ success: true })));
        const screen = await openIssue();
        await pressTestInstanceAsync(screen.findByTestId('ip-issue-archive-ATR-6')!);
        expect(response.mock.calls.map(([path]) => path)).toEqual(['/v2/sessions/worker/archive']);
        expect(storage.getState().sessions.carrier.archivedAt).toBeFalsy();
        expect(storage.getState().sessions.worker.archivedAt).toBeFalsy();
        expect(screen.findByTestId('ip-issue-archive-error-ATR-6')).not.toBeNull();
        expect(screen.getTextContent()).toContain('Title worker');
    });

    it.each(['working', 'request', 'unknown-pr'] as const)('N: hides Archive for %s and follows a new merged snapshot', async kind => {
        const now = Date.now();
        seed([session('stopped', '/fixture/atr-6'), session('other', '/fixture/atr-6', {
            active: true, activeAt: now,
            ...(kind === 'working' ? { thinking: true, thinkingAt: now } : {}),
            ...(kind === 'request' ? { agentState: { requests: { req: { tool: 'Bash', arguments: {}, createdAt: now } } } } : {}),
        })]);
        if (kind !== 'unknown-pr') merged('stopped');
        const screen = await openIssue();
        expect(screen.findByTestId('ip-issue-archive-ATR-6')).toBeNull();
        expect(response).not.toHaveBeenCalled();
        if (kind === 'unknown-pr') {
            merged('stopped');
            expect(screen.findByTestId('ip-issue-archive-ATR-6')).not.toBeNull();
        }
    });
});
