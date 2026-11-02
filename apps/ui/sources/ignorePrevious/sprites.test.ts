import { describe, expect, it } from 'vitest';
import { modelSprites, noWorkerSprite, spriteGrids } from './sprites';
import { deskThemes, spriteColours, spriteStateTokens } from './palette';

describe('M16: one face per model', () => {
    it.each([
        ['opus', 'ragdoll'], ['sonnet', 'ginger'], ['haiku', 'tuxedo'],
        ['codex', 'cxprompt'], ['fable', 'fox'],
    ] as const)('%s uses %s', (model, kind) => expect(modelSprites[model]).toBe(kind));
    it('uses the Ignore Previous robot when there is no worker', () => {
        expect(noWorkerSprite).toBe('ipdroid');
    });
});

describe('pixel grids consumable at every detail, state and theme', () => {
    for (const kind of Object.keys(spriteGrids) as (keyof typeof spriteGrids)[]) {
        for (const state of Object.keys(spriteStateTokens) as (keyof typeof spriteStateTokens)[]) {
            for (const [detail, grid] of Object.entries(spriteGrids[kind][state])) {
                it(`${kind}/${state}/${detail} is complete and all pixels resolve in every theme`, () => {
                    expect(grid).toHaveLength(16);
                    const colours: Readonly<Record<string, string>> = spriteColours[kind];
                    for (const theme of Object.values(deskThemes)) {
                        for (const row of grid) {
                            expect(row).toHaveLength(16);
                            for (const pixel of row) {
                                if (pixel === '.') continue;
                                const colour = pixel === 'O' || pixel === 'L' ? theme[spriteStateTokens[state]] : colours[pixel];
                                expect(colour, `${kind}/${state}/${detail}: ${pixel}`).toMatch(/^#[0-9a-f]{6}$/i);
                            }
                        }
                    }
                    expect(grid.join('')).toContain('O');
                });
            }
        }
    }
    it('IPB wears headphones working, at its neck idle, and removes them for attention', () => {
        for (const state of ['turn', 'stuck'] as const) expect(spriteGrids.ipb[state].S.join('')).not.toContain('C');
        expect(spriteGrids.ipb.working.S[2]).toContain('C');
        expect(spriteGrids.ipb.idle.S[12]).toContain('C');
    });
});
