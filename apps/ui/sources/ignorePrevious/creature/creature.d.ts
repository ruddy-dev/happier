export interface CreatureOptions {
    redEyes?: number;
    paleEyes?: number;
    theme?: 'dark' | 'light';
    sea?: boolean;
    fps?: number;
    paused?: boolean;
}
export interface CreatureInstance {
    set(options: CreatureOptions): void;
    advance(seconds: number): void;
    maskBox(): { x: number; y: number; w: number; u: number };
    pause(): void;
    resume(): void;
    destroy(): void;
}
export const Creature: {
    mount(container: HTMLElement, options?: CreatureOptions): CreatureInstance;
    version: string;
};
