import { beforeEach, describe, expect, it, vi } from 'vitest';
import { findTestInstanceByTypeContainingText, pressTestInstanceAsync, renderScreen } from '@/dev/testkit';

import type { IssueGroup } from '../model/groupWorkers';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const state = vi.hoisted(() => ({ navigate: vi.fn() }));

vi.mock('@expo/vector-icons', async () => {
    const { createExpoVectorIconsMock } = await import('@/dev/testkit/mocks/icons');
    return createExpoVectorIconsMock();
});

vi.mock('expo-router', async () => {
    const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
    return createExpoRouterMock({ router: { navigate: state.navigate } }).module;
});

const group: IssueGroup = {
    issueKey: 'ATR-6',
    bulb: 'turn',
    workers: [
        { sessionId: 's1', title: 'Builder', issueKey: 'ATR-6', bulb: 'turn', permissionMode: 'default', updatedAt: 20 },
        { sessionId: 's2', title: 'Reviewer', issueKey: 'ATR-6', bulb: 'working', permissionMode: 'acceptEdits', updatedAt: 10 },
    ],
};

async function renderCard(open: boolean, onToggle = vi.fn()) {
    const { IssueCard } = await import('./IssueCard');
    return { screen: await renderScreen(<IssueCard group={group} open={open} onToggle={onToggle} />), onToggle };
}

describe('IssueCard', () => {
    beforeEach(() => state.navigate.mockReset());

    it('folded, shows the issue, its bulb and the newest worker, and toggles on press', async () => {
        const { screen, onToggle } = await renderCard(false);
        expect(screen.getTextContent()).toContain('ATR-6');
        expect(screen.getTextContent()).toContain('Builder');
        expect(screen.getTextContent()).not.toContain('Reviewer');
        expect(screen.findByTestId('ip-bulb-turn')).toBeTruthy();
        await pressTestInstanceAsync(findTestInstanceByTypeContainingText(screen.tree, 'Pressable', 'ATR-6')!);
        expect(onToggle).toHaveBeenCalledTimes(1);
    });

    it('open, lists every worker with its permission mode and opens a worker', async () => {
        const { screen } = await renderCard(true);
        const text = screen.getTextContent();
        expect(text).toContain('Builder');
        expect(text).toContain('Reviewer');
        expect(text).toContain('default');
        expect(text).toContain('acceptEdits');
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
