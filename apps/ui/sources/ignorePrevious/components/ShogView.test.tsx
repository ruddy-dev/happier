import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react-test-renderer';
import { renderScreen } from '@/dev/testkit';
import { createSessionFixture } from '@/dev/testkit/fixtures/sessionFixtures';
import { buildSessionListRenderableFromSession } from '@/sync/domains/session/listing/sessionListRenderable';
import type { Session } from '@/sync/domains/state/storageTypes';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

/** Loads sessions the way a warm app holds them: in the sidebar's list and as full records. */
function seed(sessions: Session[]) {
    state.sessions = sessions;
    state.list = sessions.map((s) => buildSessionListRenderableFromSession(s));
}

const state = vi.hoisted(() => ({ sessions: [] as unknown[], list: [] as unknown[], reducedMotion: false }));

vi.mock('@/sync/store/hooks', async (importOriginal) => {
    const { createStoreHooksModuleMock } = await import('@/dev/testkit/mocks/storage');
    return createStoreHooksModuleMock({
        importOriginal,
        overrides: {
            useAllSessions: (() => state.sessions) as never,
            useAllSessionListRenderables: (() => state.list) as never,
        },
    });
});

// The OS reduced-motion setting is a host boundary.
vi.mock('@/hooks/ui/useReducedMotionPreference', async () => {
    const { installReducedMotionMock } = await import('@/dev/testkit/mocks/reducedMotion');
    return installReducedMotionMock(() => state.reducedMotion)();
});

function waitingSession(id: string): Session {
    const request = { tool: 'Bash', arguments: { command: 'ls' }, createdAt: 1 };
    return createSessionFixture({
        id,
        active: true,
        updatedAt: 10,
        agentState: { requests: { [`r-${id}`]: request } } as unknown as Session['agentState'],
    });
}

async function renderShog() {
    const { ShogView } = await import('./ShogView');
    return renderScreen(<ShogView onClose={() => {}} />);
}

function redEyes(screen: Awaited<ReturnType<typeof renderShog>>): number {
    const ids = new Set<string>();
    for (const node of screen.tree.root.findAll((n) => typeof n.props?.testID === 'string' && n.props.testID.startsWith('ip-shog-eye-red-'))) {
        ids.add(node.props.testID);
    }
    return ids.size;
}

describe('ShogView', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        seed([]);
        state.reducedMotion = false;
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('plays for about six seconds, then stands still', async () => {
        const screen = await renderShog();
        expect(screen.findByTestId('ip-shog-pause')).toBeTruthy();
        await act(async () => {
            vi.advanceTimersByTime(6000);
        });
        expect(screen.findByTestId('ip-shog-pause')).toBeNull();
        expect(screen.findByTestId('ip-shog-replay')).toBeTruthy();
    });

    it('pauses, and replays from the start with a fresh six seconds', async () => {
        const screen = await renderShog();
        await act(async () => {
            vi.advanceTimersByTime(3000);
        });
        await screen.pressByTestIdAsync('ip-shog-pause');
        expect(screen.findByTestId('ip-shog-replay')).toBeTruthy();
        await screen.pressByTestIdAsync('ip-shog-replay');
        await act(async () => {
            vi.advanceTimersByTime(4000);
        });
        // The first play's timer would have ended it here; Replay starts the six seconds again.
        expect(screen.findByTestId('ip-shog-pause')).toBeTruthy();
        await act(async () => {
            vi.advanceTimersByTime(2000);
        });
        expect(screen.findByTestId('ip-shog-replay')).toBeTruthy();
    });

    it('stands still from the start when the system asks for reduced motion', async () => {
        state.reducedMotion = true;
        const screen = await renderShog();
        expect(screen.findByTestId('ip-shog-pause')).toBeNull();
        expect(screen.findByTestId('ip-shog-replay')).toBeNull();
    });

    it('has one red eye for each thing that waits on you, up to eight', async () => {
        seed([waitingSession('a'), waitingSession('b'), waitingSession('c')]);
        let screen = await renderShog();
        expect(redEyes(screen)).toBe(3);
        await screen.unmount();

        seed(Array.from({ length: 11 }, (_, i) => waitingSession(`s${i}`)));
        screen = await renderShog();
        expect(redEyes(screen)).toBe(8);
    });
});
