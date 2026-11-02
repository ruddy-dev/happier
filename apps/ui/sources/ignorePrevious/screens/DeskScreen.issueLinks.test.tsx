import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import { loadDeskScript, startDeskScenario, type DeskScenario } from '../testkit/deskScenario';
import { pressTestInstanceAsync } from '@/dev/testkit';

// Auto-detection reads the environment at module load, as the production bundle does.
vi.hoisted(() => { vi.stubEnv('EXPO_PUBLIC_IP_COORDINATOR_PATH', '/work/coordinator/'); });
afterAll(() => { vi.unstubAllEnvs(); });


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


describe('DeskScreen issue links', () => {
    let scenario: DeskScenario | null = null;
    afterEach(async () => {
        await scenario?.dispose();
        scenario = null;
    });

    it('N1/S2/S3: rendered cards follow urgency as a list-only No issue worker starts waiting', async () => {
        scenario = await startDeskScenario({ script: loadDeskScript({
            covers: ['N1', 'S2', 'S3'], sessions: [
                { id: 'quiet', title: 'Quiet issue', path: '/work/atr-6-build', initial: { active: true } },
                { id: 'busy', title: 'Busy issue', path: '/work/atr-7-build', initial: { active: true, thinking: true } },
                { id: 'scratch', title: 'Scratch worker', path: '/work/scratch', listOnly: true, initial: { active: true } },
            ],
        }) });
        const cardOrder = () => scenario!.screen.findAll((node) =>
            typeof node.type === 'string' && typeof node.props.testID === 'string' && node.props.testID.startsWith('ip-issue-'),
        ).map((node) => node.props.testID);
        expect(cardOrder()).toEqual(['ip-issue-ATR-7', 'ip-issue-ATR-6', 'ip-issue-none']);
        await scenario.apply('scratch', { pendingPermissionRequestCount: 1 });
        expect(cardOrder()).toEqual(['ip-issue-none', 'ip-issue-ATR-7', 'ip-issue-ATR-6']);
        await scenario.apply('scratch', { pendingPermissionRequestCount: 0 });
        expect(cardOrder()).toEqual(['ip-issue-ATR-7', 'ip-issue-ATR-6', 'ip-issue-none']);
    });

    it('N2: a list-only tagged worker stays unassigned until its full record arrives', async () => {
        scenario = await startDeskScenario({ script: loadDeskScript({
            covers: ['N2'],
            sessions: [{ id: 'w1', title: 'ATR-7 other', path: '/work/atr-8-other', listOnly: true,
                initial: { active: true, metadata: { tag: 'ATR-6-build' } } }],
            steps: [{ at: 100, id: 'w1', hydrate: true }],
        }) });
        expect(scenario.textOf('ip-issue-none')).not.toBeNull();
        expect(scenario.textOf('ip-issue-ATR-7')).toBeNull();
        expect(scenario.textOf('ip-issue-ATR-8')).toBeNull();
        await scenario.advance(100);
        expect(scenario.textOf('ip-issue-ATR-6')).not.toBeNull();
        expect(scenario.textOf('ip-issue-none')).toBeNull();
        expect(scenario.textOf('ip-count-all')).toBe('1');
    });

    it('N3: workers in one repository with different tags render separate cards', async () => {
        scenario = await startDeskScenario({ script: loadDeskScript({
            covers: ['N3'], sessions: [
                { id: 'w1', title: 'First worker', path: '/work/repo', initial: { metadata: { tag: 'ATR-6-build' } } },
                { id: 'w2', title: 'Second worker', path: '/work/repo', initial: { metadata: { tag: 'ATR-7-build' } } },
            ],
        }) });
        expect(scenario.textOf('ip-issue-ATR-6')).toContain('First worker');
        expect(scenario.textOf('ip-issue-ATR-7')).toContain('Second worker');
        expect(scenario.textOf('ip-count-all')).toBe('2');
    });

    it('L10: builder and reviewer share a card even after the builder title changes', async () => {
        scenario = await startDeskScenario({ script: loadDeskScript({
            covers: ['L10'], sessions: [
                { id: 'w1', title: 'Builder', path: '/work/repo', initial: { metadata: { tag: 'ATR-6-build-1' } } },
                { id: 'w2', title: 'Reviewer', path: '/work/repo', initial: { metadata: { tag: 'ATR-6-review-1' }, updatedAt: 1 } },
            ],
        }) });
        const card = scenario.screen.findByTestId('ip-issue-ATR-6');
        await pressTestInstanceAsync(card?.findAll((node) => typeof node.props.onPress === 'function')[0]);
        expect(scenario.textOf('ip-issue-ATR-6')).toContain('Builder');
        expect(scenario.textOf('ip-issue-ATR-6')).toContain('Reviewer');
        await scenario.apply('w1', { metadata: { summary: { text: 'ATR-9 renamed', updatedAt: Date.now() } } });
        expect(scenario.textOf('ip-issue-ATR-6')).toContain('ATR-9 renamed');
        expect(scenario.textOf('ip-issue-ATR-9')).toBeNull();
        expect(scenario.textOf('ip-count-all')).toBe('2');
    });

    it('L9: hidden subagent sessions add no row while parent requests remain visible', async () => {
        scenario = await startDeskScenario({ script: loadDeskScript({
            covers: ['L9'], sessions: [
                { id: 'w1', title: 'Parent worker', path: '/work/repo', initial: { active: true, metadata: { tag: 'ATR-6-build' } } },
                { id: 'hidden', title: 'Hidden delegate', path: '/work/repo', initial: { active: true,
                    metadata: { tag: 'ATR-7-review', systemSessionV1: { hidden: true } } } },
            ],
        }) });
        await scenario.apply('w1', { requests: { subagent: { tool: 'Task', arguments: { description: 'Review the patch' } } } });
        expect(scenario.textOf('ip-count-all')).toBe('1');
        expect(scenario.textOf('ip-count-turn')).toBe('1');
        expect(scenario.textOf('ip-approvals-count')).toBe('1');
        expect(scenario.textOf('ip-issue-ATR-7')).toBeNull();
        await scenario.openApprovals();
        expect(scenario.screen.getTextContent()).toContain('Parent worker');
        expect(scenario.screen.getTextContent()).not.toContain('Hidden delegate');
    });

    it('L5: auto-detected coordinator stays out of Work but keeps its own request', async () => {
        scenario = await startDeskScenario({ script: loadDeskScript({
            covers: ['L5', 'L2'], sessions: [
                { id: 'c1', title: 'Coordinator', path: '/work/coordinator', initial: { active: true } },
                { id: 'w1', title: 'Worker', path: '/work/atr-6-build', initial: { active: true } },
            ],
        }) });
        expect(scenario.screen.findByTestId('session-view-c1')).not.toBeNull();
        await scenario.apply('c1', { requests: { q1: { tool: 'Bash', arguments: { command: 'git status' } } } });
        expect(scenario.textOf('ip-count-all')).toBe('1');
        expect(scenario.textOf('ip-count-turn')).toBe('0');
        expect(scenario.textOf('ip-issue-none')).toBeNull();
        expect(scenario.textOf('ip-approvals-count')).toBe('1');
        expect(scenario.screen.findByTestId('ip-walk-waiting')).toBeNull();
    });

    it.each([undefined, 'c1'])('L6: two candidates exclude only the selected coordinator, stored pick %s', async (coordinator) => {
        scenario = await startDeskScenario({ coordinator, script: loadDeskScript({
            covers: ['L6'], sessions: [
                { id: 'c1', title: 'Older candidate', path: '/work/coordinator', initial: { active: true } },
                { id: 'c2', title: 'Newer candidate', path: '/work/coordinator', initial: { active: true, updatedAt: 10 } },
                { id: 'w1', title: 'Worker', path: '/work/atr-6-build', initial: { active: true } },
            ],
        }) });
        const selected = coordinator ?? 'c2';
        expect(scenario.screen.findByTestId(`session-view-${selected}`)).not.toBeNull();
        expect(scenario.textOf('ip-count-all')).toBe('2');
        expect(scenario.textOf('ip-issue-none')).toContain(selected === 'c1' ? 'Newer candidate' : 'Older candidate');
        expect(scenario.textOf('ip-issue-none')).not.toContain(selected === 'c1' ? 'Older candidate' : 'Newer candidate');
    });
});
