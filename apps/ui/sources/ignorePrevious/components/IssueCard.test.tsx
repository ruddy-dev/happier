import { act } from 'react-test-renderer';
import { parsePermissionIntentAlias } from '@happier-dev/agents';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findTestInstanceByTypeContainingText, pressTestInstanceAsync, renderScreen } from '@/dev/testkit';

import { createSessionFixture } from '@/dev/testkit/fixtures/sessionFixtures';
import { storage } from '@/sync/domains/state/storage';
import { t } from '@/text';

import { groupWorkersByIssue, type IssueGroup } from '../model/groupWorkers';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const state = vi.hoisted(() => ({ navigate: vi.fn() }));

vi.mock('@expo/vector-icons', async () => {
    const { createExpoVectorIconsMock } = await import('@/dev/testkit/mocks/icons');
    return createExpoVectorIconsMock();
});

vi.mock('@react-navigation/native', async () => {
    const { createReactNavigationNativeMock } = await import('@/dev/testkit/mocks/reactNavigation');
    return createReactNavigationNativeMock();
});

vi.mock('expo-router', async () => {
    const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
    return createExpoRouterMock({ router: { navigate: state.navigate } }).module;
});

const group: IssueGroup = groupWorkersByIssue([
    { sessionId: 's1', title: 'Builder', issueKey: 'ATR-6', model: 'claude-sonnet-5.5', bulb: 'idle', permissionMode: 'default', updatedAt: 20 },
    { sessionId: 's2', title: 'Reviewer', issueKey: 'ATR-6', model: 'gpt-6.1-sol', bulb: 'turn', permissionMode: 'acceptEdits', updatedAt: 10, contextPercent: 64 },
])[0];

async function renderCard(open: boolean, onToggle = vi.fn()) {
    const { IssueCard } = await import('./IssueCard');
    return { screen: await renderScreen(<IssueCard group={group} open={open} onToggle={onToggle} />), onToggle };
}

describe('IssueCard', () => {
    it('draws the state-owning model on its 40 px card and each worker with its own state at 24 px', async () => {
        const { WorkerSprite } = await import('./WorkerSprite');
        const { screen } = await renderCard(true);
        const card = screen.findByTestId('ip-work-card-face-ATR-6')!;
        expect(card.findByType(WorkerSprite.type).props).toMatchObject({ kind: 'cxloupe', size: 40, bulb: 'turn' });
        expect(screen.findByTestId('ip-worker-face-s1')!.findByType(WorkerSprite.type).props)
            .toMatchObject({ kind: 'ginger', size: 24, bulb: 'idle' });
        expect(screen.findByTestId('ip-worker-face-s2')!.findByType(WorkerSprite.type).props)
            .toMatchObject({ kind: 'cxloupe', size: 24, bulb: 'turn' });
    });

    it('draws Droid when the issue has no worker', async () => {
        const { IssueCard } = await import('./IssueCard');
        const { WorkerSprite } = await import('./WorkerSprite');
        const screen = await renderScreen(<IssueCard group={{ ...group, stateWorker: undefined, workers: [] }} open={false} onToggle={() => {}} />);
        expect(screen.findByTestId('ip-work-card-face-ATR-6')!.findByType(WorkerSprite.type).props.kind).toBe('ipdroid');
    });
    let previous: ReturnType<typeof storage.getState>;
    beforeEach(() => {
        previous = storage.getState();
        state.navigate.mockReset();
        storage.getState().applySessions(group.workers.map((worker) => createSessionFixture({
            id: worker.sessionId,
            metadata: { ...createSessionFixture().metadata!, permissionMode: parsePermissionIntentAlias(worker.permissionMode ?? '') ?? 'default' },
        })));
    });
    afterEach(() => { act(() => storage.setState(previous, true)); });

    it('folded, shows the issue, its bulb and the newest worker, and toggles on press', async () => {
        const { screen, onToggle } = await renderCard(false);
        expect(screen.getTextContent()).toContain('ATR-6');
        expect(screen.getTextContent()).toContain('Builder');
        expect(screen.getTextContent()).not.toContain('Reviewer');
        expect(screen.findByTestId('ip-bulb-dot-turn')).toBeTruthy();
        await pressTestInstanceAsync(findTestInstanceByTypeContainingText(screen.tree, 'Pressable', 'ATR-6')!);
        expect(onToggle).toHaveBeenCalledTimes(1);
    });

    it('includes the unheard note in the folded card label', async () => {
        const { IssueCard } = await import('./IssueCard');
        const screen = await renderScreen(<IssueCard
            group={{ ...group, workers: [{ ...group.workers[0], unheardMinutes: 20 }] }}
            open={false} onToggle={() => {}}
        />);
        expect(screen.findByTestId('ip-issue-ATR-6')!.findByType('Pressable').props.accessibilityLabel)
            .toContain(t('ignorePrevious.connection.unheard', { minutes: 20 }));
    });

    it('omits the empty summary clause from the card label', async () => {
        const { IssueCard } = await import('./IssueCard');
        const screen = await renderScreen(<IssueCard group={{ ...group, workers: [] }} open={false} onToggle={() => {}} />);
        expect(screen.findByTestId('ip-issue-ATR-6')!.findByType('Pressable').props.accessibilityLabel)
            .toBe(`ATR-6: ${t('ignorePrevious.countTurn')}. ${t('ignorePrevious.workList.workerCount', { count: 0 })}`);
    });

    it('open, lists every worker with its permission mode and opens a worker', async () => {
        const { screen } = await renderCard(true);
        const text = screen.getTextContent();
        expect(text).toContain('Builder');
        expect(text).toContain('Reviewer');
        expect(text).toContain('default');
        expect(text).toContain('Published mode: safe-yolo');
        expect(screen.findByTestId('ip-worker-context-s2')?.props.children).toEqual([64, '%']);
        expect(screen.findByTestId('ip-worker-context-s1')).toBeNull();
        await screen.pressByTestIdAsync('ip-open-worker-s2');
        expect(String(state.navigate.mock.calls[0]?.[0])).toMatch(/^\/session\/s2(\?|$)/);
    });

    it('labels a group without an issue', async () => {
        const { IssueCard } = await import('./IssueCard');
        const screen = await renderScreen(
            <IssueCard group={{ ...group, issueKey: null }} open={false} onToggle={() => {}} />,
        );
        expect(screen.getTextContent()).toContain('No issue');
    });
});
