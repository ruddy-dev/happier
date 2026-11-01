import { afterEach, describe, expect, it, vi } from 'vitest';

import { pressTestInstanceAsync } from '@/dev/testkit/render/renderScreen';
import { SESSION_RUNTIME_STATUS_STALE_SIGNAL_MS } from '@/sync/domains/session/attention/deriveSessionRuntimePresentationState';
import { storage } from '@/sync/domains/state/storage';

import { loadDeskScript, startDeskScenario, type DeskScenario } from '../testkit/deskScenario';
import raw from '../testkit/scripts/F1-F2-crashed-worker.json';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;


vi.mock('@expo/vector-icons', async () => {
    const { createExpoVectorIconsMock } = await import('@/dev/testkit/mocks/icons');
    return createExpoVectorIconsMock();
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

/** Coordinator c1, and worker w1 whose last signal ("thinking") came at t0 and then nothing: its agent died. */
const script = loadDeskScript(raw);

async function openDetails(scenario: DeskScenario): Promise<void> {
    const button = scenario.screen.find((node) =>
        node.props?.accessibilityRole === 'button'
        && typeof node.props.onPress === 'function'
        && node.findAll((child) => child.children.includes('Details')).length > 0,
    );
    await pressTestInstanceAsync(button, 'Details');
}

describe('DeskScreen stale worker (F1)', () => {
    let scenario: DeskScenario | null = null;
    afterEach(async () => {
        await scenario?.dispose();
        scenario = null;
    });

    it('F1: just under the stale budget a thinking worker still counts as Working', async () => {
        scenario = await startDeskScenario({ script, coordinator: 'c1' });
        await scenario.advance(SESSION_RUNTIME_STATUS_STALE_SIGNAL_MS - 1_000);
        expect(scenario.textOf('ip-count-working')).toBe('1');
    });

    it('F1: past the stale budget a silent worker no longer counts as Working', async () => {
        scenario = await startDeskScenario({ script, coordinator: 'c1' });
        await scenario.advance(SESSION_RUNTIME_STATUS_STALE_SIGNAL_MS - 1_000);
        await scenario.advance(2_000);
        expect(scenario.textOf('ip-count-working')).toBe('0');
        expect(scenario.screen.findByTestId('ip-bulb-dot-working')).toBeNull();
    });

    it('F1: at exactly the stale budget the worker is no longer Working', async () => {
        scenario = await startDeskScenario({ script, coordinator: 'c1' });
        await scenario.advance(SESSION_RUNTIME_STATUS_STALE_SIGNAL_MS);
        expect(scenario.textOf('ip-count-working')).toBe('0');
    });

    it('F1: a new signal restarts the clock', async () => {
        scenario = await startDeskScenario({ script, coordinator: 'c1' });
        await scenario.advance(100_000);
        await scenario.apply('w1', { thinking: true });
        await scenario.advance(100_000);
        expect(scenario.textOf('ip-count-working')).toBe('1');
    });

    it('F1: a stale worker offers no Stop', async () => {
        scenario = await startDeskScenario({ script, coordinator: 'c1' });
        await openDetails(scenario);
        await scenario.advance(SESSION_RUNTIME_STATUS_STALE_SIGNAL_MS + 1_000);
        expect(scenario.screen.findByTestId('ip-stop-w1')).toBeNull();
    });

    it('F1: going stale writes nothing to the store', async () => {
        scenario = await startDeskScenario({ script, coordinator: 'c1' });
        const before = storage.getState().sessions.w1;
        await scenario.advance(SESSION_RUNTIME_STATUS_STALE_SIGNAL_MS + 1_000);
        // It did go stale, so the clock moved the count, not a write.
        expect(scenario.textOf('ip-count-working')).toBe('0');
        expect(storage.getState().sessions.w1).toBe(before);
    });

    // Decided (Q5): a stale worker keeps Allow and Deny, with a note. Built in item 2.4.
    it.todo('F2 a stale worker keeps Allow and Deny, with a note (item 2.4)');
});
