/** @vitest-environment jsdom */
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '@/text';

import { deskPrefs, type DeskPrefValue } from '../deskPrefs';
import { groupWorkersByIssue } from '../model/groupWorkers';
import { IssueCard } from './IssueCard';

// Exercise React Native Web's real accessibility-prop mapping to the rendered button.
vi.mock('react-native', async () => vi.importActual('react-native-web'));
vi.mock('expo-router', async () => {
    const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
    return createExpoRouterMock({ pathname: '/desk' }).module;
});
vi.mock('@react-navigation/native', async () => {
    const { createReactNavigationNativeMock } = await import('@/dev/testkit/mocks/reactNavigation');
    return createReactNavigationNativeMock();
});
vi.mock('@/hooks/ui/useReducedMotionPreference', async () => {
    const { createReducedMotionModuleMock } = await import('@/dev/testkit/mocks/reducedMotion');
    return createReducedMotionModuleMock(true);
});
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;
let previousStyle: DeskPrefValue<'chatStyle'>;
beforeEach(() => {
    previousStyle = deskPrefs.get('chatStyle');
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
});
afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    deskPrefs.set('chatStyle', previousStyle);
});

describe.each(['terminal', 'mask'] as const)('%s folded Work card accessible name', style => {
    it.each([
        { scenario: 'question', bulb: 'turn', stateKey: 'ignorePrevious.countTurn', reasonKey: 'ignorePrevious.question' },
        { scenario: 'view-only approval', bulb: 'waiting', stateKey: 'ignorePrevious.usageLimit.waiting', reasonKey: 'session.sharing.permissionApprovalsDisabledReadOnly' },
        { scenario: 'approval not granted', bulb: 'waiting', stateKey: 'ignorePrevious.usageLimit.waiting', reasonKey: 'session.sharing.permissionApprovalsDisabledNotGranted' },
        { scenario: 'failed turn', bulb: 'stuck', stateKey: 'ignorePrevious.countStuck', reasonKey: 'ignorePrevious.workList.failed' },
        { scenario: 'idle without attention', bulb: 'idle', stateKey: 'ignorePrevious.countIdle', reasonKey: null },
    ] as const)('retains the visible state and reason for $scenario', async ({ bulb, stateKey, reasonKey }) => {
        deskPrefs.set('chatStyle', style);
        const [group] = groupWorkersByIssue([{
            sessionId: 'worker', title: 'Worker title', issueKey: 'ATR-18', bulb,
            permissionMode: null, updatedAt: 1,
        }]);
        const attention = reasonKey ? t(reasonKey) : undefined;
        await act(async () => root.render(<IssueCard
            group={group}
            open={false}
            onToggle={() => {}}
            item={{ id: 'ATR-18', title: 'Card title', status: 'active', pr: null }}
            projectName="Demo project"
            attention={attention}
            calm
        />));

        const button = container.querySelector('[data-testid="ip-issue-ATR-18"] [role="button"]');
        expect(button).not.toBeNull();
        expect(button?.getAttribute('aria-expanded')).toBe('false');
        // With no aria-labelledby, the rendered aria-label is this button's accessible name.
        // Descendant text alone cannot catch a name that replaces the visible status with a reason.
        expect(button?.hasAttribute('aria-labelledby')).toBe(false);
        const name = button?.getAttribute('aria-label');
        expect(button?.textContent).toContain(t(stateKey));
        if (attention) expect(button?.textContent).toContain(attention);
        expect(name).toContain(t(stateKey));
        if (attention) expect(name).toContain(attention);
        expect(name).toContain('Card title');
        expect(name).toContain('Demo project');
        expect(name).toContain('ATR-18');
        expect(name).toContain(t('ignorePrevious.workList.workerCount', { count: 1 }));
    });
});
