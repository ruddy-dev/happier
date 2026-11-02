import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { renderScreen } from '@/dev/testkit';
import { createSessionFixture } from '@/dev/testkit/fixtures/sessionFixtures';
import { storage } from '@/sync/domains/state/storage';
import type { Session } from '@/sync/domains/state/storageTypes';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

/** Loads sessions into the real store the way the first sync does: list rows and full records. */
function seed(sessions: Session[]) {
    act(() => {
        storage.getState().applySessions(sessions);
        storage.getState().applyReady();
    });
}

const state = vi.hoisted(() => ({
    submit: vi.fn(async (..._args: unknown[]) => undefined),
    alert: vi.fn(),
}));

vi.mock('@expo/vector-icons', async () => {
    const { createExpoVectorIconsMock } = await import('@/dev/testkit/mocks/icons');
    return createExpoVectorIconsMock();
});

// The network send is the boundary.
vi.mock('@/sync/sync', async () => {
    const { installSyncStub } = await import('@/dev/testkit/mocks/sync');
    return installSyncStub({ submitMessage: (...args: unknown[]) => state.submit(...args) } as never)();
});

vi.mock('@/modal', async () => {
    const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
    return createModalModuleMock({ spies: { alert: state.alert } }).module;
});

function session(id: string, request: Record<string, unknown> | null): Session {
    return createSessionFixture({
        id,
        active: true,
        metadata: { path: '/home/u/dev', host: 'h', homeDir: '/home/u', machineId: 'm', summary: { text: `Title ${id}`, updatedAt: 1 } } as Session['metadata'],
        agentState: request ? ({ requests: { r1: request } } as unknown as Session['agentState']) : null,
    });
}

async function renderPrompts() {
    const { CoordinatorPrompts } = await import('./CoordinatorPrompts');
    return renderScreen(<CoordinatorPrompts coordinatorId="coord" />);
}

describe('CoordinatorPrompts', () => {
    let previous: ReturnType<typeof storage.getState>;
    afterEach(() => {
        act(() => {
            storage.setState(previous, true);
        });
    });

    beforeEach(() => {
        previous = storage.getState();
        state.submit.mockReset().mockResolvedValue(undefined);
        state.alert.mockReset();
    });

    it('asks the coordinator to go through every waiting request, with what each one runs', async () => {
        seed([
            session('coord', null),
            session('s1', { tool: 'Bash', arguments: { command: 'rm -rf build', description: 'Clean the build' }, createdAt: 10 }),
            session('s2', { tool: 'Edit', arguments: { file_path: '/home/u/dev/a.ts' }, createdAt: 20 }),
        ]);
        const screen = await renderPrompts();
        await screen.pressByTestIdAsync('ip-walk-waiting');

        expect(state.submit).toHaveBeenCalledTimes(1);
        const [sessionId, text, displayText] = state.submit.mock.calls[0]!;
        expect(sessionId).toBe('coord');
        expect(text).toContain('rm -rf build');
        expect(text).toContain('Clean the build');
        expect(text).toContain('/home/u/dev/a.ts');
        expect(text).toContain('s1');
        expect(text).toContain('Title s2');
        expect(typeof displayText).toBe('string');
        expect(String(text).length).toBeGreaterThan(String(displayText).length);
    });

    it('L2: the walk-through includes worker requests but never its own coordinator request', async () => {
        seed([
            session('coord', { tool: 'Bash', arguments: { command: 'coordinator-command' }, createdAt: 10 }),
            session('s1', { tool: 'Bash', arguments: { command: 'worker-command' }, createdAt: 20 }),
        ]);
        const screen = await renderPrompts();
        await screen.pressByTestIdAsync('ip-walk-waiting');
        const text = String(state.submit.mock.calls[0]?.[1]);
        expect(text).toContain('worker-command');
        expect(text).not.toContain('coordinator-command');
        expect(text).not.toContain('Title coord');
    });

    it('L2: no walk-through when only the coordinator waits', async () => {
        seed([session('coord', { tool: 'Bash', arguments: { command: 'coordinator-command' }, createdAt: 10 })]);
        const screen = await renderPrompts();
        expect(screen.findByTestId('ip-walk-waiting')).toBeNull();
    });

    it('L2: an unloaded coordinator request is also excluded from the walk-through', async () => {
        seed([{ ...session('coord', null), pendingPermissionRequestCount: 1, pendingRequestObservedAt: Date.now() }]);
        const screen = await renderPrompts();
        expect(screen.findByTestId('ip-walk-waiting')).toBeNull();
    });

    it('offers only the PR walk-through when nothing waits', async () => {
        seed([session('coord', null)]);
        const screen = await renderPrompts();
        expect(screen.findByTestId('ip-walk-waiting')).toBeNull();
        await screen.pressByTestIdAsync('ip-walk-prs');
        expect(state.submit.mock.calls[0]?.[0]).toBe('coord');
    });

    it('says so when the message could not be sent', async () => {
        seed([session('coord', null)]);
        state.submit.mockRejectedValue(new Error('offline'));
        const screen = await renderPrompts();
        await screen.pressByTestIdAsync('ip-walk-prs');
        expect(state.alert).toHaveBeenCalledTimes(1);
    });
});
