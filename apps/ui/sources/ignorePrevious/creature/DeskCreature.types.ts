import type { CreatureMode } from './creatureMode';

export type DeskCreatureProps = Readonly<{
    style: 'slips' | 'terminal';
    redEyes: number;
    mode: CreatureMode;
    width?: number | '100%';
    height?: number;
    /** Header layout keeps the creature's head behind its foreground mask through resize. */
    anchor?: Readonly<{ x: number; y: number }>;
    scale?: number;
}>;
