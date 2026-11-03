import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react-test-renderer';
import { renderScreen } from '@/dev/testkit';
import { createSessionFixture } from '@/dev/testkit/fixtures/sessionFixtures';
import { storage } from '@/sync/domains/state/storage';
import { DeskCreature } from '../creature/DeskCreature';
import { deskPrefs } from '../deskPrefs';
import { terminalPalettes } from '../palette';
import type { Session } from '@/sync/domains/state/storageTypes';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const state = vi.hoisted(() => ({ reducedMotion: false }));

/** Loads sessions into the real store the way the first sync does. */
function seed(sessions: Session[]) {
    act(() => {
        if (sessions.length > 0) storage.getState().applySessions(sessions);
        storage.getState().applyReady();
    });
}

// The OS reduced-motion setting is a host boundary.
vi.mock('@/hooks/ui/useReducedMotionPreference', async () => {
    const { installReducedMotionMock } = await import('@/dev/testkit/mocks/reducedMotion');
    return installReducedMotionMock(() => state.reducedMotion)();
});

function waitingSession(id: string, version = 1): Session {
    const request = { tool: 'Bash', arguments: { command: 'ls' }, createdAt: 1 };
    return createSessionFixture({
        id,
        active: true,
        updatedAt: 10,
        agentState: { requests: { [`r-${id}`]: request } } as unknown as Session['agentState'],
        agentStateVersion: version,
    });
}

async function renderShog() {
    const { ShogView } = await import('./ShogView');
    return renderScreen(<ShogView onClose={() => {}} />);
}

function redEyes(screen: Awaited<ReturnType<typeof renderShog>>): number {
    const creatures = screen.tree.root.findAllByType(DeskCreature);
    expect(creatures).toHaveLength(1);
    return creatures[0].props.redEyes;
}

describe('ShogView', () => {
    let previousState: ReturnType<typeof storage.getState>;
    beforeEach(() => {
        previousState = storage.getState();
        vi.useFakeTimers();
        state.reducedMotion = false;
        deskPrefs.set('chatStyle', 'mask');
        deskPrefs.set('terminalPalette', 'tokyo');
        deskPrefs.set('creatureEnabled', true);
    });
    afterEach(() => {
        storage.setState(previousState, true);
        deskPrefs.set('chatStyle', 'mask');
        deskPrefs.set('terminalPalette', 'tokyo');
        vi.useRealTimers();
    });

    it.each(['mask', 'terminal'] as const)('R43 keeps the full creature and smaller tilted mask in %s', async style => {
        deskPrefs.set('chatStyle', style);
        const screen = await renderShog();
        const creature = screen.tree.root.findByType(DeskCreature);
        await act(async () => creature.parent!.props.onLayout({ nativeEvent: { layout: { width: 600 } } }));
        expect(creature.props.style).toBe('slips');
        expect(creature.props.scale).toBe(1.6);
        const overlay = creature.parent!.findByProps({ pointerEvents: 'none' });
        expect(overlay.props.style.transform).toEqual([{ rotate: '-6deg' }]);
        expect(overlay.props.children.props.size).toBeCloseTo(55);
    });

    it('R43 applies the selected Terminal palette and bracketed controls beside the status', async () => {
        deskPrefs.set('chatStyle', 'terminal');
        deskPrefs.set('terminalPalette', 'gruvbox');
        const screen = await renderShog();
        expect(screen.findByTestId('ip-shog')!.props.style.backgroundColor).toBe(terminalPalettes.gruvbox.bg);
        const creature = screen.tree.root.findByType(DeskCreature);
        expect(creature.props.artTheme).toBe('dark');
        expect(creature.props.maskColours.bone).toBe(terminalPalettes.gruvbox.maskrim);
        const footer = screen.findByTestId('ip-shog-footer')!;
        expect(footer.findAllByProps({ testID: 'ip-shog-pause' }).length).toBeGreaterThan(0);
        expect(footer.findAllByProps({ testID: 'ip-shog-status' }).length).toBeGreaterThan(0);
        expect(screen.getTextContent()).toContain('[ Pause ]');
        expect(screen.getTextContent()).toContain('[ Close ]');
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

    it.each([0, 3, 8, 12])('M13 sends %i shared waits to the real creature, capped at eight eyes', async count => {
        seed(Array.from({ length: count }, (_, i) => waitingSession(`worker-${i}`)));
        const screen = await renderShog();
        expect(redEyes(screen)).toBe(Math.min(count, 8));
    });

    it('F4 keeps all eyes pale until the first waits snapshot is ready', async () => {
        seed([waitingSession('worker')]);
        act(() => storage.setState({ isDataReady: false }));
        const screen = await renderShog();
        expect(redEyes(screen)).toBe(0);
        act(() => storage.getState().applyReady());
        expect(redEyes(screen)).toBe(1);
    });

    it('opens another red eye when a request arrives while it is showing', async () => {
        seed([createSessionFixture({ id: 'a', active: true, updatedAt: 10 })]);
        const screen = await renderShog();
        expect(redEyes(screen)).toBe(0);
        act(() => {
            storage.getState().applySessions([waitingSession('a', 2)]);
        });
        expect(redEyes(screen)).toBe(1);
    });
});
