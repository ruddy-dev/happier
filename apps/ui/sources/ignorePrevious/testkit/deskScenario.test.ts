import { afterEach, describe, expect, it, vi } from 'vitest';

import { storage } from '@/sync/domains/state/storage';

import { getStoredCoordinatorId } from '../deskPrefs';
import { loadDeskScript, startDeskScenario, type DeskScenario } from './deskScenario';
import f1Script from './scripts/F1-F2-crashed-worker.json';
import f4Script from './scripts/F4-cold-load.json';
import l1Script from './scripts/L1-coordinator-row.json';
import w2Script from './scripts/W2-double-allow.json';
import w6Script from './scripts/W6-unloaded-record.json';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-native-safe-area-context', async () => {
    const { createSafeAreaContextMock } = await import('@/dev/testkit/mocks/nativeEnvironment');
    return createSafeAreaContextMock({ keyboard: { isVisible: false, height: 0 }, safeArea: { top: 0, right: 0, bottom: 0, left: 0 } });
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
    const { deskScreenMocks } = await import('./deskScreenMocks');
    return deskScreenMocks.sessionView();
});

vi.mock('@/hooks/session/useHydrateSessionForRoute', async () => {
    const { deskScreenMocks } = await import('./deskScreenMocks');
    return deskScreenMocks.hydrateSessionForRoute();
});

const bash = { tool: 'Bash', arguments: { command: 'npm test' } };

/** A coordinator and one worker that already has one command waiting. */
const script = loadDeskScript({
    id: 'HARNESS-two-sessions',
    covers: ['HARNESS'],
    sessions: [
        { id: 'c1', title: 'Coordinator', path: '/work/coordinator', initial: { active: true } },
        { id: 'w1', title: 'Fix the login form', path: '/work/wt/app-1-login', initial: { active: true, requests: { r1: bash } } },
    ],
    steps: [],
});

describe('deskScenario', () => {
    let scenario: DeskScenario | null = null;
    afterEach(async () => {
        await scenario?.dispose();
        scenario = null;
    });

    it('HARNESS-ready: without applyReady the picker shows only after ready()', async () => {
        scenario = await startDeskScenario({ script, dataReady: false });
        // Before the first sync the desk must not ask for a coordinator: it doesn't know the sessions yet.
        expect(scenario.screen.getTextContent()).not.toContain('Pick the coordinator session');
        await scenario.ready();
        expect(scenario.screen.getTextContent()).toContain('Pick the coordinator session');
    });

    it('HARNESS-coordinator: the coordinator option picks the chat without the picker', async () => {
        scenario = await startDeskScenario({ script, coordinator: 'c1' });
        expect(scenario.screen.findByTestId('session-view-c1')).toBeTruthy();
        expect(scenario.screen.getTextContent()).not.toContain('Pick the coordinator session');
    });

    it('HARNESS-late: a late step is a no-op, a stamped one lands', async () => {
        scenario = await startDeskScenario({ script, coordinator: 'c1' });
        expect(scenario.textOf('ip-approvals-count')).toBe('1 request');

        // An echo older than what the store holds: the store keeps the newer requests.
        await scenario.apply('w1', { requests: { r2: bash } }, { late: true });
        expect(scenario.textOf('ip-approvals-count')).toBe('1 request');

        // The same patch as a fresh observation is taken.
        await scenario.apply('w1', { requests: { r2: bash } });
        expect(scenario.textOf('ip-approvals-count')).toBe('2 requests');
    });

    it('HARNESS-steps: advance applies due steps in order, at their time', async () => {
        const stepped = loadDeskScript({
            ...script,
            steps: [
                { at: 5_000, id: 'w1', patch: { requests: { r2: bash } } },
                { at: 10_000, id: 'w1', patch: { requests: { r1: null, r2: null } } },
            ],
        });
        scenario = await startDeskScenario({ script: stepped, coordinator: 'c1' });
        const t0 = Date.now();
        await scenario.advance(4_999);
        expect(scenario.textOf('ip-approvals-count')).toBe('1 request');
        await scenario.advance(1);
        expect(scenario.textOf('ip-approvals-count')).toBe('2 requests');
        expect(storage.getState().sessions.w1?.agentState?.requests?.r2?.createdAt).toBe(t0 + 5_000);
        await scenario.advance(5_000);
        expect(scenario.textOf('ip-approvals-count')).toBe('0 requests');
        expect(Date.now()).toBe(t0 + 10_000);
    });

    it('HARNESS-dispose: leaves the store and the desk prefs as it found them', async () => {
        const previous = storage.getState();
        const coordinatorBefore = getStoredCoordinatorId();
        const started = await startDeskScenario({ script, coordinator: 'c1' });
        expect(storage.getState()).not.toBe(previous);
        await started.dispose();
        expect(storage.getState()).toBe(previous);
        expect(getStoredCoordinatorId()).toBe(coordinatorBefore);
        expect(vi.isFakeTimers()).toBe(false);
    });

    it('HARNESS-script: a bad script names the bad field', () => {
        expect(() => loadDeskScript({ ...script, sessions: [{ id: 'x', title: 'X' }] })).toThrow(/sessions\.0\.path/);
    });

    it('HARNESS-scripts: every scenario script loads', () => {
        for (const raw of [f1Script, f4Script, l1Script, w2Script, w6Script]) {
            expect(loadDeskScript(raw).covers.length).toBeGreaterThan(0);
        }
    });
});
