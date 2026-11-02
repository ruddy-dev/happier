import { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useUnistyles } from 'react-native-unistyles';
import { storage } from '@/sync/domains/state/storage';
import { t } from '@/text';
import { ipPalette } from '../palette';
import { loadDeskScript, startDeskScenario, type DeskScenario } from '../testkit/deskScenario';

vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock();
});

const viewport = vi.hoisted(() => ({ width: 390, height: 900 }));
vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock({ useWindowDimensions: () => viewport });
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
    return createExpoRouterMock().module;
});

vi.mock('@/modal', async () => {
    const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
    return createModalModuleMock().module;
});

vi.mock('@/sync/sync', async () => {
    const { installSyncStub } = await import('@/dev/testkit/mocks/sync');
    return installSyncStub()();
});

vi.mock('@/hooks/ui/useReducedMotionPreference', async () => {
    const { installReducedMotionMock } = await import('@/dev/testkit/mocks/reducedMotion');
    return installReducedMotionMock(false)();
});

vi.mock('@/components/sessions/shell/SessionView', async () => {
    const { deskScreenMocks } = await import('../testkit/deskScreenMocks');
    return deskScreenMocks.sessionView();
});

vi.mock('@/hooks/session/useHydrateSessionForRoute', async () => {
    const { deskScreenMocks } = await import('../testkit/deskScreenMocks');
    return deskScreenMocks.hydrateSessionForRoute();
});


const key = 'ATR-12345678901234567890';
const summary = 'A long worker summary that must remain available when the visible line is truncated';
const script = loadDeskScript({
    covers: ['N1', 'S1', 'W1', 'W6'],
    sessions: [
        { id: 'builder', title: summary, path: `/work/${key.toLowerCase()}-build`, initial: { active: true, thinking: true } },
        { id: 'reviewer', title: 'Review changes', path: `/work/${key.toLowerCase()}-review`, initial: { active: true } },
    ],
});

describe('Work presentation (N1, S1, W-series)', () => {
    let scenario: DeskScenario | null = null;
    afterEach(async () => {
        await scenario?.dispose();
        scenario = null;
        useUnistyles().theme.dark = false;
    });

    it.each([390, 1100, 1440])('N1: Work and collapsed rail ScrollView direction is vertical at %i (overflow needs live QA)', async (width) => {
        viewport.width = width;
        scenario = await startDeskScenario({ script });
        const scrolls = () => scenario!.screen.tree.root.findAll(node => typeof node.type === 'string' && String(node.type) === 'ScrollView');
        expect(scrolls().some(node => node.props.horizontal === true)).toBe(false);
        await scenario.screen.pressByTestIdAsync('ip-work-collapse');
        expect(scrolls().some(node => node.props.horizontal === true)).toBe(false);
        expect(scenario.screen.findByTestId(`ip-rail-issue-${key}`)).toBeTruthy();
    });

    it('N1: a folded card exposes the full key and summary plus the worker count', async () => {
        scenario = await startDeskScenario({ script });
        const card = scenario.screen.findByTestId(`ip-issue-${key}`)!;
        const toggle = card.findByType('Pressable');
        expect(toggle.props.accessibilityLabel).toContain(key);
        expect(toggle.props.accessibilityLabel).toContain(summary);
        expect(scenario.textOf(`ip-work-worker-count-${key}`)).toBe(t('ignorePrevious.workList.workerCount', { count: 2 }));
        const labels = card.findAll(node => typeof node.type === 'string' && String(node.type) === 'Text' && [key, summary].includes(node.props.children));
        expect(labels).toHaveLength(2);
        for (const label of labels) expect(label.props.numberOfLines).toBe(1);
        await scenario.screen.pressByTestIdAsync('ip-work-collapse');
        const rail = scenario.screen.findByTestId(`ip-rail-issue-${key}`)!;
        expect(rail.props.accessibilityLabel).toContain(key);
        expect(rail.props.accessibilityLabel).toContain(t('ignorePrevious.countWorking'));
        expect(rail.props.accessibilityLabel).toContain(t('ignorePrevious.workList.workerCount', { count: 2 }));
    });

    it('S1: all 55 supplied workers remain represented in cards and the rail', async () => {
        scenario = await startDeskScenario({ script: loadDeskScript({
            covers: ['S1'],
            sessions: Array.from({ length: 55 }, (_, i) => ({ id: `worker-${i}`, title: `Worker ${i}`, path: `/work/atr-${i + 1}-build` })),
        }) });
        expect(scenario.textOf('ip-count-all')).toBe('55');
        const ids = (prefix: string) => scenario!.screen.tree.root.findAll(node =>
            typeof node.type === 'string' && typeof node.props.testID === 'string' && node.props.testID.startsWith(prefix));
        expect(ids('ip-work-worker-count-')).toHaveLength(55);
        await scenario.screen.pressByTestIdAsync('ip-work-collapse');
        expect(ids('ip-rail-issue-')).toHaveLength(55);
    });

    it.each(([
        ['turn', 'turnSignal', 'countTurn'],
        ['working', 'work', 'countWorking'],
        ['stuck', 'red', 'countStuck'],
        ['idle', 'idleSignal', 'countIdle'],
    ] as const).flatMap(([bulb, token, word]) => (['light', 'dark'] as const).map(scheme => ({ bulb, token, word, scheme }))))('W1/W6: $bulb uses its signal token and a word in $scheme cards and rail', async ({ bulb, token, word, scheme }) => {
        useUnistyles().theme.dark = scheme === 'dark';
        scenario = await startDeskScenario({ script });
        act(() => {
            const current = storage.getState().sessions.builder;
            storage.getState().applySessions([{
                ...current, seq: current.seq + 1,
                thinking: bulb === 'working',
                pendingPermissionRequestCount: bulb === 'turn' ? 1 : 0,
                pendingRequestObservedAt: Date.now(),
                latestTurnStatus: bulb === 'stuck' ? 'failed' : null,
                latestTurnStatusObservedAt: Date.now(),
                lastRuntimeIssue: bulb === 'stuck' ? { v: 1, scope: 'primary_session', status: 'failed', code: 'usage_limit', source: 'usage_limit', occurredAt: Date.now() } : null,
            }]);
        });
        const check = (id: string) => {
            const container = scenario!.screen.findByTestId(id)!;
            const dot = container.findAll(node => typeof node.type === 'string' && String(node.type) === 'View' && node.props.testID === `ip-bulb-dot-${bulb}`)[0];
            expect(dot).toBeTruthy();
            expect(dot.props.style.backgroundColor).toBe(ipPalette[scheme][token]);
            expect(scenario!.textOf(id)).toContain(t(`ignorePrevious.${word}`));
        };
        const card = scenario.screen.findByTestId(`ip-issue-${key}`)!;
        if (bulb === 'stuck') expect(card.props.style.borderColor).toBe(ipPalette[scheme].red);
        if (bulb === 'turn') {
            const bar = card.findAll(node => typeof node.type === 'string' && node.props.pointerEvents === 'none')[0];
            expect(bar.props.style.backgroundColor).toBe(ipPalette[scheme].turnSignal);
        }
        check(`ip-issue-${key}`);
        await scenario.screen.pressByTestIdAsync('ip-work-collapse');
        check(`ip-rail-issue-${key}`);
    });
});
