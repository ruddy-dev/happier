import type { CreatureMode } from './creatureMode';

export type DeskCreatureProps = Readonly<{
    style: 'slips' | 'terminal';
    redEyes: number;
    mode: CreatureMode;
    width?: number | '100%';
    height?: number;
}>;
