import type { IpColours } from '../palette';
import type { CreatureMode } from './creatureMode';

export type DeskCreatureProps = Readonly<{
    style: 'slips' | 'terminal';
    redEyes: number;
    mode: CreatureMode;
    /** Paused holds the same canvas. Playing delegates the duration to a surface with Pause/Replay. */
    playback?: 'playing' | 'paused';
    artTheme?: 'light' | 'dark';
    maskColours?: IpColours;
    width?: number | '100%';
    height?: number;
    /** Header layout keeps the creature's head behind its foreground mask through resize. */
    anchor?: Readonly<{ x: number; y: number }>;
    scale?: number;
}>;
