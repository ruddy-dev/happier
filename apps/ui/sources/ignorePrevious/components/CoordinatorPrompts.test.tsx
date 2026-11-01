import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderScreen } from '@/dev/testkit';
import { createSessionFixture } from '@/dev/testkit/fixtures/sessionFixtures';
import type { Session } from '@/sync/domains/state/storageTypes';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const state = vi.hoisted(() => ({
    sessions: [] as unknown[],
    submit: vi.fn(async (..._args: unknown[]) => undefined),
    alert: vi.fn(),
}));

vi.mock('@expo/vector-icons', async () => {
    const { createExpoVectorIconsMock } = await import('@/dev/testkit/mocks/icons');
    return createExpoVectorIconsMock();
});

vi.mock('@/sync/store/hooks', async (importOriginal) => {
    const { createStoreHooksModuleMock } = await import('@/dev/testkit/mocks/storage');
    return createStoreHooksModuleMock({
        importOriginal,
        overrides: { useAllSessions: (() => state.sessions) as never },
    });
});

// The network send is the boundary; Happier's own card tests mock it the same way.
vi.mock('@/sync/sync', () => ({
    sync: { submitMessage: (...args: unknown[]) => state.submit(...args) },
}));

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
    beforeEach(() => {
        state.submit.mockReset().mockResolvedValue(undefined);
        state.alert.mockReset();
    });

    it('asks the coordinator to go through every waiting request, with what each one runs', async () => {
        state.sessions = [
            session('coord', null),
            session('s1', { tool: 'Bash', arguments: { command: 'rm -rf build', description: 'Clean the build' }, createdAt: 10 }),
            session('s2', { tool: 'Edit', arguments: { file_path: '/home/u/dev/a.ts' }, createdAt: 20 }),
        ];
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

    it('offers only the PR walk-through when nothing waits', async () => {
        state.sessions = [session('coord', null)];
        const screen = await renderPrompts();
        expect(screen.findByTestId('ip-walk-waiting')).toBeNull();
        await screen.pressByTestIdAsync('ip-walk-prs');
        expect(state.submit.mock.calls[0]?.[0]).toBe('coord');
    });

    it('says so when the message could not be sent', async () => {
        state.sessions = [session('coord', null)];
        state.submit.mockRejectedValue(new Error('offline'));
        const screen = await renderPrompts();
        await screen.pressByTestIdAsync('ip-walk-prs');
        expect(state.alert).toHaveBeenCalledTimes(1);
    });
});
