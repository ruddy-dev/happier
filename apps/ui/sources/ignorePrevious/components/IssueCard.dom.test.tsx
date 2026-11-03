/** @vitest-environment jsdom */
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '@/text';
import { storage } from '@/sync/domains/state/storage';
import { createSessionFixture } from '@/dev/testkit/fixtures/sessionFixtures';
import type { Session } from '@/sync/domains/state/storageTypes';

import { deskPrefs, type DeskPrefValue } from '../deskPrefs';
import { groupWorkersByIssue } from '../model/groupWorkers';
import { IssueCard } from './IssueCard';
import { WorkColumn } from './WorkColumn';
import { usageLimitIssue } from '../testkit/usageLimitFixtures';
import { DeskFixtureRouteContext } from '../deskFixtureGate';

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
let previousStorage: ReturnType<typeof storage.getState>;
beforeEach(() => {
    // Keep the shared desk-clock snapshot deterministic even before a session is connected.
    vi.spyOn(Date, 'now').mockReturnValue(new Date(2026, 10, 4, 12, 0).getTime());
    previousStorage = storage.getState();
    storage.setState(storage.getInitialState(), true);
    vi.stubEnv('EXPO_PUBLIC_IP_WQ_DIR', '');
    previousStyle = deskPrefs.get('chatStyle');
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
});
afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    deskPrefs.set('chatStyle', previousStyle);
    storage.setState(previousStorage, true);
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
});

describe.each(['terminal', 'mask'] as const)('%s folded Work card accessible name', style => {
    it('keeps a known project while the issue record is unavailable, then falls back without inventing one', async () => {
        deskPrefs.set('chatStyle', style);
        const [group] = groupWorkersByIssue([{
            sessionId: 'worker', title: 'Session fallback', issueKey: 'ATR-18', bulb: 'idle',
            permissionMode: null, updatedAt: 1,
        }]);
        const render = (projectName?: string) => <IssueCard group={group} open={false} onToggle={() => {}} projectName={projectName} calm />;
        await act(async () => root.render(render('Demo project')));
        const button = () => container.querySelector('[data-testid="ip-issue-ATR-18"] [role="button"]');
        expect(button()?.textContent).toContain('Demo project');
        expect(button()?.getAttribute('aria-label')).toContain('Demo project');
        expect(button()?.textContent).toContain('Session fallback');
        await act(async () => root.render(render()));
        expect(button()?.textContent).not.toContain('Demo project');
        expect(button()?.getAttribute('aria-label')).not.toContain('Demo project');
        expect(button()?.textContent).toContain('ATR-18');
    });

    it('identifies fixture inventory without inventing queue records or production project associations', async () => {
        deskPrefs.set('chatStyle', style);
        const render = (fixture: boolean) => <DeskFixtureRouteContext.Provider value={fixture}><WorkColumn /></DeskFixtureRouteContext.Provider>;
        await act(async () => root.render(render(true)));
        expect(container.querySelector('[data-testid="ip-work-sample-inventory"]')).not.toBeNull();
        expect(container.querySelector('[data-testid="ip-count-all"]')?.textContent).toBe('–');
        await act(async () => root.render(render(false)));
        expect(container.querySelector('[data-testid="ip-work-sample-inventory"]')).toBeNull();
    });

    it.each(['known', 'unknown', 'due'] as const)('names a usage-limit wait through Work with a %s reset', async reset => {
        deskPrefs.set('chatStyle', style);
        const now = new Date(2026, 10, 4, 12, 0).getTime();
        vi.spyOn(Date, 'now').mockReturnValue(now);
        const resetAt = reset === 'unknown' ? null : now + (reset === 'due' ? -1 : 1) * 60_000;
        const worker = createSessionFixture({
            id: 'limited', active: false, updatedAt: now,
            metadata: { path: '/work/atr-18-limited', host: 'fixture' },
            latestTurnStatus: 'failed', latestTurnStatusObservedAt: now,
            lastRuntimeIssue: usageLimitIssue(now, resetAt),
        });
        await act(async () => {
            storage.getState().applySessions([worker]);
            storage.getState().applyReady();
            root.render(<WorkColumn />);
        });
        const card = container.querySelector('[data-testid="ip-issue-ATR-18"]');
        const button = card?.querySelector('[role="button"]') as HTMLElement | null;
        expect(button).not.toBeNull();
        expect(button?.getAttribute('aria-expanded')).toBe('false');
        await act(async () => button?.focus());
        expect(document.activeElement).toBe(button);
        const name = button?.getAttribute('aria-label');
        expect(name).toContain(t('ignorePrevious.usageLimit.waiting'));
        expect(name).toContain(t('connectedServices.pools.behavior.switchOn.usageLimit'));
        const time = resetAt === null ? null : new Date(resetAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
        const detail = reset === 'unknown' ? t('ignorePrevious.usageLimit.waitsForReset')
            : reset === 'due' ? t('ignorePrevious.usageLimit.resetDue')
            : t('ignorePrevious.usageLimit.waitsForResetAt', { time: time! });
        expect(card?.querySelector('[data-testid="ip-worker-usage-limit-limited"]')?.textContent).toBe(detail);
        if (time) expect(name).not.toContain(time);
        await act(async () => button?.click());
        expect(button?.getAttribute('aria-expanded')).toBe('true');
        expect(button?.getAttribute('aria-label')).toBe(name);
        expect(card?.querySelector('[data-testid="ip-worker-usage-limit-limited"]')?.textContent).toBe(detail);
        expect(card?.querySelector('[data-testid="ip-open-worker-limited"]')).not.toBeNull();
        await act(async () => {
            storage.getState().applySessions([{ ...worker, seq: worker.seq + 1,
                latestTurnStatus: 'completed', latestTurnStatusObservedAt: now + 1,
                lastRuntimeIssue: null }]);
        });
        expect(button?.getAttribute('aria-label')).not.toContain(t('connectedServices.pools.behavior.switchOn.usageLimit'));
        expect(card?.querySelector('[data-testid="ip-worker-usage-limit-limited"]')).toBeNull();
    });

    it.each(['multiple limits', 'working sibling', 'question sibling', 'failed sibling', 'view-only sibling', 'view-only limited worker', 'ungranted limited worker'] as const)(
        'keeps the state owner and reset details for %s', async scenario => {
            deskPrefs.set('chatStyle', style);
            const now = new Date(2026, 10, 4, 12, 0).getTime();
            vi.spyOn(Date, 'now').mockReturnValue(now);
            const limited = createSessionFixture({
                id: 'limited', active: false, updatedAt: now - 1,
                metadata: { path: '/work/atr-18-limited', host: 'fixture' },
                latestTurnStatus: 'failed', latestTurnStatusObservedAt: now,
                lastRuntimeIssue: usageLimitIssue(now, now + 60_000),
            });
            const pending: Partial<Session> = {
                active: true, activeAt: now, pendingRequestObservedAt: now,
                pendingPermissionRequestCount: 1,
                agentState: { requests: { request: { tool: 'Bash', kind: 'permission', arguments: { command: 'pwd' }, createdAt: now } } },
            };
            let other: Partial<Session>;
            if (scenario === 'multiple limits') other = { ...limited, lastRuntimeIssue: usageLimitIssue(now, now + 120_000) };
            else if (scenario === 'working sibling') other = { active: true, activeAt: now, thinking: true, thinkingAt: now };
            else if (scenario === 'failed sibling') other = { active: true, activeAt: now, latestTurnStatus: 'failed', latestTurnStatusObservedAt: now,
                lastRuntimeIssue: { v: 1, scope: 'primary_session', status: 'failed', code: 'provider_exit', source: 'provider_process_exit', occurredAt: now } };
            else if (scenario === 'question sibling') other = { ...pending, pendingPermissionRequestCount: 0, pendingUserActionRequestCount: 1,
                agentState: { requests: { request: { tool: 'AskUserQuestion', kind: 'user_action', arguments: { question: 'Proceed?' }, createdAt: now } } } };
            else other = { ...pending, accessLevel: scenario === 'ungranted limited worker' ? 'edit' : 'view', canApprovePermissions: false };
            const sameWorker = scenario === 'view-only limited worker' || scenario === 'ungranted limited worker';
            const workers = sameWorker ? [{ ...limited, ...other }] : [limited, createSessionFixture({
                ...other, id: 'other', updatedAt: now, metadata: { path: '/work/atr-18-other', host: 'fixture' },
            })];
            await act(async () => {
                storage.getState().applySessions(workers);
                storage.getState().applyReady();
                root.render(<WorkColumn />);
            });
            const card = container.querySelector('[data-testid="ip-issue-ATR-18"]');
            const button = card?.querySelector('[role="button"]') as HTMLElement | null;
            expect(button).not.toBeNull();
            const name = button?.getAttribute('aria-label');
            const limitReason = t('connectedServices.pools.behavior.switchOn.usageLimit');
            const ownsLimit = scenario === 'multiple limits' || sameWorker;
            if (ownsLimit) expect(name?.split(limitReason)).toHaveLength(2);
            else expect(name).not.toContain(limitReason);
            const stateKey = scenario === 'working sibling' ? 'ignorePrevious.countWorking'
                : scenario === 'question sibling' ? 'ignorePrevious.countTurn'
                : scenario === 'failed sibling' ? 'ignorePrevious.countStuck' : 'ignorePrevious.usageLimit.waiting';
            expect(name).toContain(t(stateKey));
            if (scenario === 'question sibling') expect(name).toContain(t('ignorePrevious.question'));
            if (scenario === 'failed sibling') expect(name).toContain(t('ignorePrevious.workList.failed'));
            if (scenario.startsWith('view-only')) expect(name).toContain(t('session.sharing.permissionApprovalsDisabledReadOnly'));
            if (scenario === 'ungranted limited worker') expect(name).toContain(t('session.sharing.permissionApprovalsDisabledNotGranted'));
            const time = (at: number) => new Date(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
            expect(name).not.toContain(time(now + 60_000));
            expect(name).not.toContain(time(now + 120_000));
            if (scenario === 'multiple limits') {
                expect(card?.querySelector('[data-testid="ip-issue-usage-limits-ATR-18"]')?.textContent).toBe(t('ignorePrevious.usageLimit.nextKnownResetAt', {
                    count: t('ignorePrevious.usageLimit.limitedCount', { count: 2 }), time: time(now + 60_000),
                }));
            }
            await act(async () => button?.click());
            expect(button?.getAttribute('aria-label')).toBe(name);
            expect(card?.querySelector('[data-testid="ip-worker-usage-limit-limited"]')?.textContent).toBe(t('ignorePrevious.usageLimit.waitsForResetAt', { time: time(now + 60_000) }));
            if (scenario === 'multiple limits') expect(card?.querySelector('[data-testid="ip-worker-usage-limit-other"]')?.textContent)
                .toBe(t('ignorePrevious.usageLimit.waitsForResetAt', { time: time(now + 120_000) }));
        },
    );

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
