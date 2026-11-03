import * as React from 'react';
import { useUnistyles } from 'react-native-unistyles';
import { useReducedMotionPreference } from '@/hooks/ui/useReducedMotionPreference';
import { MaskFace } from '../components/MaskFace';
import type { CreatureInstance, CreatureOptions } from './creature';
import { CREATURE_BURST_MS } from './creatureMode';
import { creatureLabel } from './creatureLabel';
import type { DeskCreatureProps } from './DeskCreature.types';

// The collapsed header has no pause button. Bound automatic decoration to five seconds
// per live working/burst episode, within DESIGN.md's WCAG 2.2.2 boundary.
// A new burst after a paused/spent episode gets at least the model's 3 s budget.
export const CREATURE_RUN_CAP_MS = 5000;
let liveOwner: symbol | null = null;

export function DeskCreature({ style, redEyes, mode, playback, artTheme, maskColours, width = '100%', height = 128, anchor, scale }: DeskCreatureProps) {
    const { theme } = useUnistyles();
    const reducedMotion = useReducedMotionPreference();
    const container = React.useRef<HTMLDivElement>(null);
    const sync = React.useRef<(() => void) | null>(null);
    const current = React.useRef({ style, redEyes, mode, playback, reducedMotion, light: artTheme ? artTheme === 'light' : !theme.dark, anchor, scale });
    current.current = { style, redEyes, mode, playback, reducedMotion, light: artTheme ? artTheme === 'light' : !theme.dark, anchor, scale };
    const [running, setRunning] = React.useState(false);
    const [loadFailed, setLoadFailed] = React.useState(false);

    React.useEffect(() => {
        const element = container.current;
        if (!element) return;
        const owner = Symbol('desk creature');
        let creature: CreatureInstance | null = null;
        let disposed = false;
        let onscreen = false;
        let lastMode = current.current.mode;
        let remaining = CREATURE_RUN_CAP_MS;
        let applied: { redEyes: number; sea: boolean; theme: 'light' | 'dark'; anchor: DeskCreatureProps['anchor']; scale: number | undefined } | null = null;
        let startedAt: number | null = null;
        let timer: ReturnType<typeof setTimeout> | undefined;

        const stop = () => {
            if (startedAt !== null) remaining = Math.max(0, remaining - (performance.now() - startedAt));
            startedAt = null;
            clearTimeout(timer);
            creature?.pause();
            if (liveOwner === owner) liveOwner = null;
            if (!disposed) setRunning(false);
        };
        const update = () => {
            const value = current.current;
            if (value.mode !== lastMode) {
                const wasMoving = lastMode === 'working' || lastMode === 'burst';
                const hadLiveLoop = startedAt !== null;
                stop();
                lastMode = value.mode;
                if (!wasMoving) remaining = CREATURE_RUN_CAP_MS;
                else if (value.mode === 'burst' && !hadLiveLoop) remaining = Math.max(remaining, CREATURE_BURST_MS);
            }
            const next = { redEyes: value.redEyes, sea: value.style === 'slips', theme: value.light ? 'light' as const : 'dark' as const, anchor: value.anchor, scale: value.scale };
            if (creature && applied) {
                const changes: CreatureOptions = {};
                if (next.redEyes !== applied.redEyes) changes.redEyes = next.redEyes;
                if (next.sea !== applied.sea) changes.sea = next.sea;
                if (next.theme !== applied.theme) changes.theme = next.theme;
                if (next.anchor?.x !== applied.anchor?.x || next.anchor?.y !== applied.anchor?.y) changes.anchor = next.anchor;
                if (next.scale !== applied.scale) changes.scale = next.scale;
                if (Object.keys(changes).length) {
                    creature.pause();
                    creature.set(changes);
                    applied = next;
                }
            }
            const canRun = onscreen && !document.hidden && !value.reducedMotion
                && value.playback !== 'paused' && (value.mode === 'working' || value.mode === 'burst')
                && (value.playback === 'playing' || remaining > 0);
            if (!creature || !canRun || (liveOwner !== null && liveOwner !== owner)) { stop(); return; }
            if (startedAt !== null) { creature.resume(); return; }
            liveOwner = owner;
            startedAt = performance.now();
            creature.resume();
            setRunning(true);
            if (value.playback !== 'playing') timer = setTimeout(() => { stop(); remaining = 0; }, remaining);
        };
        sync.current = update;
        const visibility = () => update();
        document.addEventListener('visibilitychange', visibility);
        const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(entries => {
            onscreen = entries[entries.length - 1]?.isIntersecting === true;
            update();
        });
        observer?.observe(element);
        // Loading after commit also keeps browser-only Path2D artwork out of server rendering.
        void import('./creature').then(({ Creature }) => {
            if (disposed) return;
            const value = current.current;
            applied = { redEyes: value.redEyes, sea: value.style === 'slips', theme: value.light ? 'light' : 'dark', anchor: value.anchor, scale: value.scale };
            creature = Creature.mount(element, { ...applied, paused: true, fps: 20, paleEyes: 4 });
            creature.advance(6);
            update();
        }).catch(error => {
            if (disposed) return;
            stop();
            creature?.destroy();
            creature = null;
            console.warn('Desk creature engine unavailable; showing a still.', error);
            setLoadFailed(true);
        });
        return () => {
            disposed = true;
            sync.current = null;
            observer?.disconnect();
            document.removeEventListener('visibilitychange', visibility);
            stop();
            creature?.destroy();
        };
    }, []);

    React.useEffect(() => { sync.current?.(); }, [style, redEyes, mode, playback, reducedMotion, theme.dark, artTheme, anchor?.x, anchor?.y, scale]);
    return <div ref={container} role="img" aria-label={creatureLabel(mode, running)} data-testid="ip-creature"
        style={{ position: 'relative', width, height, overflow: 'hidden', pointerEvents: 'none',
            filter: style === 'terminal' ? 'grayscale(1)' : undefined, opacity: style === 'terminal' ? 0.6 : 1 }}>
        {loadFailed && <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <MaskFace size={40} bulb="rest" colours={maskColours} />
        </div>}
    </div>;
}
