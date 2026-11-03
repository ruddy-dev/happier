import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { storage } from '@/sync/domains/state/storage';
import { renderScreen } from '@/dev/testkit';
import { useSession } from '@/sync/store/hooks';
import { CoordinatorHeader } from '../components/CoordinatorHeader';
import { DeskCreature } from '../creature/DeskCreature';
import { CoordinatorCard } from '../components/CoordinatorCard';
import { sessionContextMeter } from '../components/ContextMeter';
import { t } from '@/text';

import { loadDeskScript, startDeskScenario, type DeskScenario } from '../testkit/deskScenario';
import raw from '../testkit/scripts/L1-coordinator-row.json';

const viewport = vi.hoisted(() => ({ width: 1440, height: 900, scale: 1, fontScale: 1 }));


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

/** Coordinator c1 and workers w1 and w2, all busy. The coordinator is the chat, not a worker. */
const script = loadDeskScript(raw);

function CoordinatorHeaderProbe() {
    const session = useSession('c1');
    return <CoordinatorHeader session={session} onOpenShog={() => {}} />;
}


describe('DeskScreen coordinator row (L1)', () => {
    let scenario: DeskScenario | null = null;
    let card: Awaited<ReturnType<typeof renderScreen>> | null = null;
    afterEach(async () => {
        await card?.unmount();
        card = null;
        await scenario?.dispose();
        scenario = null;
        viewport.width = 1440;
        vi.unstubAllEnvs();
    });

    it('L1: the Work panel counts only the workers', async () => {
        scenario = await startDeskScenario({ script, coordinator: 'c1' });
        expect(scenario.textOf('ip-count-all')).toBe('2');
    });

    it('L1: the coordinator gets no "No issue" card', async () => {
        scenario = await startDeskScenario({ script, coordinator: 'c1' });
        expect(scenario.screen.getTextContent()).not.toContain('No issue');
    });

    it('L1: a question from the coordinator is not counted as a worker waiting on you', async () => {
        scenario = await startDeskScenario({ script, coordinator: 'c1' });
        await scenario.apply('c1', { requests: { q1: { tool: 'Bash', arguments: { command: 'git push' } } } });
        expect(scenario.textOf('ip-count-turn')).toBe('0');
    });

    it.each([390, 1100, 1440])('card precedes Work at %i and opens the coordinator chat', async (width) => {
        viewport.width = width;
        scenario = await startDeskScenario({ script, coordinator: 'c1' });
        if (width === 390) await scenario.screen.pressByTestIdAsync('ip-tab-work');
        const form = width === 390 ? 'full' : 'slim';
        const cardId = `ip-coord-card-${form}`;
        const work = scenario.screen.findByTestId('ip-work')!;
        const ids = work.findAll(node => typeof node.type === 'string' && node.props.testID)
            .map(node => node.props.testID);
        expect(ids).toContain(cardId);
        expect(ids.indexOf(cardId)).toBeLessThan(ids.indexOf('ip-count-all'));
        expect(scenario.textOf('ip-count-all')).toBe('2');
        await scenario.screen.pressByTestIdAsync(cardId);
        if (width === 390) expect(scenario.screen.findByTestId('ip-tab-shog')!.props.accessibilityState.selected).toBe(true);
    });

    it.each([900, 1440])('card is a rail button before worker faces at %i', async (width) => {
        viewport.width = width;
        scenario = await startDeskScenario({ script, coordinator: 'c1' });
        await scenario.screen.pressByTestIdAsync('ip-work-collapse');
        const rail = scenario.screen.findByTestId('ip-work-rail')!;
        const ids = rail.findAll(node => typeof node.type === 'string' && node.props.testID)
            .map(node => node.props.testID);
        expect(ids).toContain('ip-coord-card-rail');
        expect(ids.indexOf('ip-coord-card-rail')).toBeLessThan(ids.indexOf('ip-rail-issue-ATR-6'));
        expect(scenario.screen.findByTestId('ip-rail-issue-none')).toBeNull();
        expect(scenario.screen.findByTestId('ip-coord-card-rail')!.props.accessibilityRole).toBe('button');
        await scenario.screen.pressByTestIdAsync('ip-coord-card-rail');
        expect(scenario.screen.findByTestId('ip-coordinator-pane')).not.toBeNull();
    });

    it('counts only coordinator questions in both state lines while keeping the worker walk-through (L1/L2)', async () => {
        viewport.width = 390;
        scenario = await startDeskScenario({ script, coordinator: 'c1' });
        await scenario.screen.pressByTestIdAsync('ip-tab-work');
        expect(scenario.textOf('ip-coord-card-state')).toBe('Thinking');
        act(() => storage.getState().applyMessagesLoaded('c1'));
        await scenario.apply('c1', { thinking: false });
        expect(scenario.textOf('ip-coord-card-state')).toBe('Idle');
        await scenario.apply('c1', { requests: { own: { tool: 'AskUserQuestion', arguments: { questions: [] } } } });
        expect(scenario.textOf('ip-coord-card-waiting')).toBe(t('ignorePrevious.coordinatorCard.waiting', { count: 1 }));
        expect(scenario.textOf('ip-count-turn')).toBe('0');
        await scenario.apply('w1', { requests: { worker: { tool: 'Bash', arguments: { command: 'echo ready' } } } });
        expect(scenario.textOf('ip-coord-card-state')).toBe('Waiting on you: 1');
        expect(scenario.textOf('ip-coord-card-waiting')).toBe(t('ignorePrevious.coordinatorCard.waiting', { count: 1 }));
        expect(scenario.textOf('ip-count-all')).toBe('2');
        expect(scenario.textOf('ip-count-turn')).toBe('1');
        // The existing walk-through excludes the coordinator's own blocked prompt (L2).
        expect(scenario.textOf('ip-walk-waiting')).toContain('(1)');
        await scenario.apply('c1', { completed: { own: 'approved' } });
        expect(scenario.textOf('ip-coord-card-waiting')).toBe(t('ignorePrevious.coordinatorCard.waiting', { count: 0 }));
        expect(scenario.textOf('ip-coord-card-state')).toBe('Idle');
        expect(scenario.textOf('ip-approvals-count')).toBe('1');
        await scenario.apply('c1', { active: false, thinking: true });
        expect(scenario.textOf('ip-coord-card-state')).toBe('offline');
    });

    it.each(['full', 'slim', 'rail'] as const)('the real %s card withholds the count and Idle until waits are ready', async (form) => {
        scenario = await startDeskScenario({ script, coordinator: 'c1', dataReady: false });
        act(() => storage.getState().applyMessagesLoaded('c1'));
        await scenario.apply('c1', { thinking: false });
        // DeskScreen hides the card before list readiness. Mount its real owner to reach unknown waits.
        card = await renderScreen(<CoordinatorCard sessionId="c1" form={form} onOpen={() => {}} />);
        const label = () => card!.findByTestId(`ip-coord-card-${form}`)!.props.accessibilityLabel;
        expect(card.findByTestId(`ip-coord-card-${form}`)).not.toBeNull();
        expect(card.findByTestId('ip-coord-card-waiting')).toBeNull();
        expect(card.findByTestId('ip-coord-card-state')).toBeNull();
        expect(label()).not.toContain(t('ignorePrevious.coordinatorHeader.idle'));
        expect(label()).not.toContain(t('ignorePrevious.coordinatorCard.waiting', { count: 0 }));
        await scenario.ready();
        expect(card.findByTestId('ip-coord-card-waiting')).not.toBeNull();
        expect(label()).toContain(t('ignorePrevious.coordinatorHeader.idle'));
        expect(label()).toContain(t('ignorePrevious.coordinatorCard.waiting', { count: 0 }));
    });

    it('does not claim zero waits or Idle before the coordinator list is ready', async () => {
        viewport.width = 390;
        scenario = await startDeskScenario({ script, coordinator: 'c1', dataReady: false });
        await scenario.screen.pressByTestIdAsync('ip-tab-work');
        expect(scenario.screen.findByTestId('ip-coord-card-full')).toBeNull();
        expect(scenario.textOf('ip-coord-card-state')).toBeNull();
        expect(scenario.textOf('ip-coord-card-waiting')).toBeNull();
        act(() => storage.getState().applyMessagesLoaded('c1'));
        await scenario.apply('c1', { thinking: false });
        await scenario.ready();
        expect(scenario.textOf('ip-coord-card-state')).toBe('Idle');
        expect(scenario.textOf('ip-coord-card-waiting')).toContain('0');
    });

    it('ruling (b): header, full card, eyes and event animation follow only coordinator questions', async () => {
        scenario = await startDeskScenario({ script, coordinator: 'c1' });
        act(() => storage.getState().applyMessagesLoaded('c1'));
        await scenario.apply('c1', { thinking: false });
        card = await renderScreen(<CoordinatorCard sessionId="c1" form="full" onOpen={() => {}} />);
        const creature = () => scenario!.screen.findByType(DeskCreature).props;
        const sameState = (count: number) => {
            const expected = count ? t('ignorePrevious.coordinatorHeader.waiting', { count }) : t('ignorePrevious.coordinatorHeader.idle');
            expect(scenario!.textOf('ip-coord-state')).toBe(expected);
            expect(card!.findByTestId('ip-coord-card-state')!.children.join('')).toBe(expected);
            expect(card!.findByTestId('ip-coord-card-waiting')!.children.join('')).toBe(t('ignorePrevious.coordinatorCard.waiting', { count }));
            expect(creature().redEyes).toBe(Math.min(count, 8));
        };
        sameState(0);
        await scenario.apply('w1', { requests: { worker: { tool: 'Bash', arguments: { command: 'echo ready' } } } });
        sameState(0);
        expect(creature().mode).toBe('rest');
        await scenario.apply('c1', { requests: { own: { tool: 'AskUserQuestion', arguments: { questions: [] } } } });
        sameState(1);
        expect(creature().mode).toBe('burst');
        await scenario.advance(3_000);
        expect(creature().mode).toBe('rest');
        await scenario.apply('w2', { requests: { worker2: { tool: 'Bash', arguments: { command: 'echo ready' } } } });
        sameState(1);
        expect(creature().mode).toBe('rest');
        await scenario.apply('c1', { completed: { own: 'approved' } });
        sameState(0);
        await scenario.openApprovals();
        expect(scenario.screen.findByTestId('ip-waiting-card-worker')).not.toBeNull();
        expect(scenario.screen.findByTestId('ip-waiting-card-worker2')).not.toBeNull();
        expect(scenario.textOf('ip-approvals-count')).toBe('2');
        await scenario.apply('c1', { requests: Object.fromEntries(Array.from({ length: 10 }, (_, i) => [
            `own-${i}`, { tool: 'AskUserQuestion', arguments: { questions: [] } },
        ])) });
        sameState(10);
    });

    it('ruling (b): header and card withhold unknown coordinator counts through loading and unreadable details', async () => {
        scenario = await startDeskScenario({ script, coordinator: 'c1', dataReady: false });
        await scenario.apply('c1', { thinking: false });
        card = await renderScreen(<><CoordinatorHeaderProbe /><CoordinatorCard sessionId="c1" form="full" onOpen={() => {}} /></>);
        const unknown = () => {
            expect(card!.findByTestId('ip-coord-state')).toBeNull();
            expect(card!.findByTestId('ip-coord-card-state')).toBeNull();
            expect(card!.findByTestId('ip-coord-card-waiting')).toBeNull();
            expect(card!.findByType(DeskCreature).props.mode).toBe('rest');
        };
        unknown();
        await scenario.ready();
        unknown();
        await scenario.apply('c1', { pendingUserActionRequestCount: 1 });
        unknown();
        act(() => storage.getState().applyMessagesLoaded('c1'));
        unknown(); // A reported wait with unreadable details still has no exact question count.
        await scenario.apply('c1', { pendingUserActionRequestCount: 0, pendingPermissionRequestCount: 0 });
        expect(scenario.textOf('ip-coord-state')).toBe('Idle');
        expect(card.findByTestId('ip-coord-card-state')!.children.join('')).toBe('Idle');
    });

    it('C9: full card uses the composer meter source and removes missing reports', async () => {
        viewport.width = 390;
        vi.stubEnv('EXPO_PUBLIC_IP_AUTOCOMPACT_CLAUDE', '220000');
        scenario = await startDeskScenario({ script, coordinator: 'c1' });
        await scenario.screen.pressByTestIdAsync('ip-tab-work');
        expect(scenario.textOf('ip-coord-card-context')).toBeNull();
        const report = (contextSize: number | null) => act(() => {
            const current = storage.getState().sessions.c1;
            storage.getState().applySessions([{ ...current, seq: current.seq + 1,
                metadata: { ...current.metadata!, flavor: 'claude' }, metadataVersion: current.metadataVersion + 1,
                latestUsage: contextSize === null ? null : {
                    inputTokens: 0, outputTokens: 0, cacheCreation: 0, cacheRead: 0,
                    contextSize, contextSizeIsReported: true, contextWindowTokens: 1_000_000, timestamp: Date.now(),
                },
            }]);
        });
        for (const used of [95_500, 300_000]) {
            report(used);
            const meter = sessionContextMeter(storage.getState().sessions.c1)!;
            expect(scenario.textOf('ip-coord-card-context')).toBe(t('ignorePrevious.contextGauge.percent', { percent: meter.percent }));
            expect(scenario.screen.findByTestId('ip-coord-card-context-meter')!.props.accessibilityValue.now).toBe(meter.ratio * 100);
        }
        report(null);
        expect(scenario.textOf('ip-coord-card-context')).toBeNull();
    });

    it('must not hide anyone when no coordinator is picked', async () => {
        scenario = await startDeskScenario({ script });
        expect(scenario.textOf('ip-count-all')).toBe('3');
        expect(scenario.screen.findByTestId('ip-coord-card-slim')).toBeNull();
    });

    it('L1: the coordinator\'s request still shows in what waits on you', async () => {
        scenario = await startDeskScenario({ script, coordinator: 'c1' });
        await scenario.apply('c1', { requests: { q1: { tool: 'Bash', arguments: { command: 'git push' } } } });
        expect(scenario.textOf('ip-approvals-count')).toBe('1');
    });
});

// Exercise the existing layout modes at their real viewport breakpoints.
vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock({ useWindowDimensions: () => viewport });
});
