import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { modelSprites, noWorkerSprite, spriteForModel, spriteGrids } from './sprites';
import { deskThemes, spriteColours, spriteStateTokens } from './palette';

describe('M16: one face per model', () => {
    it.each([
        ['claude-opus-5', 'ragdoll'], ['CLAUDE-SONNET-5.5', 'ginger'],
        ['claude-haiku-5.5', 'tuxedo'], ['claude-fable-5', 'fox'],
        ['claude-future-99', 'ragdoll'], ['Sonnet', 'ginger'],
        ['gpt-6.1-sol', 'cxloupe'], ['GPT-6-TERRA', 'cxprompt'],
        ['gpt-6-astra', 'cxlab'], ['gpt-99-unknown', 'cxprompt'],
        ['gpt-6-solstice', 'cxprompt'], ['claude-sonnetish', 'ragdoll'],
        ['gpt_6_sol', 'cxloupe'], ['claude_sonnet', 'ginger'],
        ['gpt_6_solstice', 'cxprompt'], ['gpt_6_terrain', 'cxprompt'],
        ['gpt-6-terrain-astra', 'cxlab'], ['gptish_6_sol', 'no-worker'],
        ['gemini-3', 'no-worker'], ['unknown', 'no-worker'], ['default', 'no-worker'],
        ['', 'no-worker'], ['   ', 'no-worker'], [null, 'no-worker'], [undefined, 'no-worker'],
    ] as const)('resolves model id %s to %s', (model, kind) => expect(spriteForModel(model)).toBe(kind));
    it.each([
        ['opus', 'ragdoll'], ['sonnet', 'ginger'], ['haiku', 'tuxedo'],
        ['codex', 'cxprompt'], ['fable', 'fox'],
    ] as const)('%s uses %s', (model, kind) => expect(modelSprites[model]).toBe(kind));
    it('uses the Ignore Previous robot when there is no worker', () => {
        expect(noWorkerSprite).toBe('ipdroid');
    });
});

describe('pixel grids consumable at every detail, state and theme', () => {
    it('F5: waiting has a lit neutral signal and reuses each working still', () => {
        expect(spriteStateTokens.waiting).toBe(spriteStateTokens.working);
        for (const states of Object.values(spriteGrids)) expect(states.waiting).toEqual(states.working);
    });
    it('preserves the pixel content of every kind, state and detail', () => {
        const hashes: Record<string, string> = {};
        for (const [kind, states] of Object.entries(spriteGrids)) {
            for (const [state, details] of Object.entries(states)) {
                if (state === 'waiting') continue; // F5 reuses the working still; covered above.
                for (const [detail, grid] of Object.entries(details)) {
                    hashes[`${kind}/${state}/${detail}`] = createHash('sha256').update(grid.join('\n')).digest('hex');
                }
            }
        }
        expect(hashes).toMatchInlineSnapshot(`
          {
            "cxlab/idle/L": "ceba18aa0dc055bf7a352c470b0779218c9e28ac9a6386ffa2abc23f3f176a85",
            "cxlab/idle/M": "ceba18aa0dc055bf7a352c470b0779218c9e28ac9a6386ffa2abc23f3f176a85",
            "cxlab/idle/S": "ceba18aa0dc055bf7a352c470b0779218c9e28ac9a6386ffa2abc23f3f176a85",
            "cxlab/stuck/L": "f5e4f465b58227f48a6a609b0019a3d7eacf2da22f734f36dbc89c3f8268140d",
            "cxlab/stuck/M": "f5e4f465b58227f48a6a609b0019a3d7eacf2da22f734f36dbc89c3f8268140d",
            "cxlab/stuck/S": "f5e4f465b58227f48a6a609b0019a3d7eacf2da22f734f36dbc89c3f8268140d",
            "cxlab/turn/L": "58bc12358cef88335d376a788bb09a35aa5060b62f29331badf88bf775a82a76",
            "cxlab/turn/M": "58bc12358cef88335d376a788bb09a35aa5060b62f29331badf88bf775a82a76",
            "cxlab/turn/S": "58bc12358cef88335d376a788bb09a35aa5060b62f29331badf88bf775a82a76",
            "cxlab/working/L": "0caa6ae8ace01b8ea64c5c028ac52a3b53304fbf09f5750dc50b14a92ee2d87c",
            "cxlab/working/M": "0caa6ae8ace01b8ea64c5c028ac52a3b53304fbf09f5750dc50b14a92ee2d87c",
            "cxlab/working/S": "0caa6ae8ace01b8ea64c5c028ac52a3b53304fbf09f5750dc50b14a92ee2d87c",
            "cxloupe/idle/L": "f7f2a323c1c1c26133da5dfd6521d90c90fbedaaf8d6beddb0592cf9613f4dce",
            "cxloupe/idle/M": "f7f2a323c1c1c26133da5dfd6521d90c90fbedaaf8d6beddb0592cf9613f4dce",
            "cxloupe/idle/S": "f7f2a323c1c1c26133da5dfd6521d90c90fbedaaf8d6beddb0592cf9613f4dce",
            "cxloupe/stuck/L": "819b9ea9dec3d21a0951d59e90e0e7b3aae1a9e29a780ac02e19d911f46d13a3",
            "cxloupe/stuck/M": "819b9ea9dec3d21a0951d59e90e0e7b3aae1a9e29a780ac02e19d911f46d13a3",
            "cxloupe/stuck/S": "819b9ea9dec3d21a0951d59e90e0e7b3aae1a9e29a780ac02e19d911f46d13a3",
            "cxloupe/turn/L": "4af5052213bdaa6062a70398dce4c7c59ec29bcd81cb861ff28cd488a78e445f",
            "cxloupe/turn/M": "4af5052213bdaa6062a70398dce4c7c59ec29bcd81cb861ff28cd488a78e445f",
            "cxloupe/turn/S": "4af5052213bdaa6062a70398dce4c7c59ec29bcd81cb861ff28cd488a78e445f",
            "cxloupe/working/L": "ee45b6b56a64317ac18dedd8468b9b56857367d849a313bfa7ce16c6aa9445ee",
            "cxloupe/working/M": "ee45b6b56a64317ac18dedd8468b9b56857367d849a313bfa7ce16c6aa9445ee",
            "cxloupe/working/S": "ee45b6b56a64317ac18dedd8468b9b56857367d849a313bfa7ce16c6aa9445ee",
            "cxprompt/idle/L": "7045fbef797db75b94f3b1aa50536b4d46c0f530b2fc29dcf2641e1f9b392475",
            "cxprompt/idle/M": "7045fbef797db75b94f3b1aa50536b4d46c0f530b2fc29dcf2641e1f9b392475",
            "cxprompt/idle/S": "7045fbef797db75b94f3b1aa50536b4d46c0f530b2fc29dcf2641e1f9b392475",
            "cxprompt/stuck/L": "a53f17419852a1d2fabe762091aef672059ce87a6cd97a42902bfa22f42473cb",
            "cxprompt/stuck/M": "a53f17419852a1d2fabe762091aef672059ce87a6cd97a42902bfa22f42473cb",
            "cxprompt/stuck/S": "a53f17419852a1d2fabe762091aef672059ce87a6cd97a42902bfa22f42473cb",
            "cxprompt/turn/L": "72b6527e4c5e6f335147d44d8c7684590f6ed3e375dc8d5af7de433f1fabd5ae",
            "cxprompt/turn/M": "72b6527e4c5e6f335147d44d8c7684590f6ed3e375dc8d5af7de433f1fabd5ae",
            "cxprompt/turn/S": "72b6527e4c5e6f335147d44d8c7684590f6ed3e375dc8d5af7de433f1fabd5ae",
            "cxprompt/working/L": "909d9ab24eb224b2bb81e5b8255acfcbef187144708871cc798d751e92992351",
            "cxprompt/working/M": "909d9ab24eb224b2bb81e5b8255acfcbef187144708871cc798d751e92992351",
            "cxprompt/working/S": "909d9ab24eb224b2bb81e5b8255acfcbef187144708871cc798d751e92992351",
            "fox/idle/L": "0b51da0f251bfa3917d3a1ac24ed8b252f33d873bc4baa0deeb8b7edb674f9d8",
            "fox/idle/M": "0b51da0f251bfa3917d3a1ac24ed8b252f33d873bc4baa0deeb8b7edb674f9d8",
            "fox/idle/S": "0b51da0f251bfa3917d3a1ac24ed8b252f33d873bc4baa0deeb8b7edb674f9d8",
            "fox/stuck/L": "150a3d50835a9abaaa2b5266aaff0356320f8dc886bf87ef78c207cab46eeeed",
            "fox/stuck/M": "150a3d50835a9abaaa2b5266aaff0356320f8dc886bf87ef78c207cab46eeeed",
            "fox/stuck/S": "150a3d50835a9abaaa2b5266aaff0356320f8dc886bf87ef78c207cab46eeeed",
            "fox/turn/L": "bb61d6f59c7f8fc1ced613ce6a5ded0d791232788d84cd5e9ccc6dea99ef97e4",
            "fox/turn/M": "aaa78b1c5c4130d6ac54335fdfd882a8aa8e60c593404defd0e7fe08a382005a",
            "fox/turn/S": "aaa78b1c5c4130d6ac54335fdfd882a8aa8e60c593404defd0e7fe08a382005a",
            "fox/working/L": "0b51da0f251bfa3917d3a1ac24ed8b252f33d873bc4baa0deeb8b7edb674f9d8",
            "fox/working/M": "0b51da0f251bfa3917d3a1ac24ed8b252f33d873bc4baa0deeb8b7edb674f9d8",
            "fox/working/S": "0b51da0f251bfa3917d3a1ac24ed8b252f33d873bc4baa0deeb8b7edb674f9d8",
            "ginger/idle/L": "17b77b310eec8c6c235bc12b06f396b9cb6f1f3432c7a9e02f63d3f2bc9c1db0",
            "ginger/idle/M": "17b77b310eec8c6c235bc12b06f396b9cb6f1f3432c7a9e02f63d3f2bc9c1db0",
            "ginger/idle/S": "17b77b310eec8c6c235bc12b06f396b9cb6f1f3432c7a9e02f63d3f2bc9c1db0",
            "ginger/stuck/L": "8fa2090dc23a8f056d7313258abf5153a8be35e8b69554096fe077ef013ad82f",
            "ginger/stuck/M": "8fa2090dc23a8f056d7313258abf5153a8be35e8b69554096fe077ef013ad82f",
            "ginger/stuck/S": "8fa2090dc23a8f056d7313258abf5153a8be35e8b69554096fe077ef013ad82f",
            "ginger/turn/L": "2ab2bc1df28fcd855cd9429a17910d587c6df1a8ce2e35a272e720f0ac4d3398",
            "ginger/turn/M": "e71b5d3045dc0a0dce7faae1f8829d7e87e42b4eb4b429fc580ab4e7ba600dfc",
            "ginger/turn/S": "e71b5d3045dc0a0dce7faae1f8829d7e87e42b4eb4b429fc580ab4e7ba600dfc",
            "ginger/working/L": "17b77b310eec8c6c235bc12b06f396b9cb6f1f3432c7a9e02f63d3f2bc9c1db0",
            "ginger/working/M": "17b77b310eec8c6c235bc12b06f396b9cb6f1f3432c7a9e02f63d3f2bc9c1db0",
            "ginger/working/S": "17b77b310eec8c6c235bc12b06f396b9cb6f1f3432c7a9e02f63d3f2bc9c1db0",
            "ipb/idle/L": "3d5d0e2851fd26cc11cad018b57c7b3a9d58c59a5fd859f831f477b4a7fc5ff1",
            "ipb/idle/M": "3d5d0e2851fd26cc11cad018b57c7b3a9d58c59a5fd859f831f477b4a7fc5ff1",
            "ipb/idle/S": "3d5d0e2851fd26cc11cad018b57c7b3a9d58c59a5fd859f831f477b4a7fc5ff1",
            "ipb/stuck/L": "850526fe21c36c11e124d205c0e16eae9d9fdf5c5146e44012733d7c064def30",
            "ipb/stuck/M": "850526fe21c36c11e124d205c0e16eae9d9fdf5c5146e44012733d7c064def30",
            "ipb/stuck/S": "850526fe21c36c11e124d205c0e16eae9d9fdf5c5146e44012733d7c064def30",
            "ipb/turn/L": "9746381728087255eb74b3b6e9e8e1d369b952220e58adf2363c07672ada067a",
            "ipb/turn/M": "9746381728087255eb74b3b6e9e8e1d369b952220e58adf2363c07672ada067a",
            "ipb/turn/S": "9746381728087255eb74b3b6e9e8e1d369b952220e58adf2363c07672ada067a",
            "ipb/working/L": "ac33c31628a95831da157e3a104a256320e9a371adb82f25f2e690c2caa474df",
            "ipb/working/M": "ac33c31628a95831da157e3a104a256320e9a371adb82f25f2e690c2caa474df",
            "ipb/working/S": "ac33c31628a95831da157e3a104a256320e9a371adb82f25f2e690c2caa474df",
            "ipdroid/idle/L": "a602c0893ba63d1e2330e9633df36fe4788b706b9651664b565cc114cecd2482",
            "ipdroid/idle/M": "a602c0893ba63d1e2330e9633df36fe4788b706b9651664b565cc114cecd2482",
            "ipdroid/idle/S": "a602c0893ba63d1e2330e9633df36fe4788b706b9651664b565cc114cecd2482",
            "ipdroid/stuck/L": "fe74f32c2c22e19487078efecdf114b8c8d76fb15a6269f235175007204b94fc",
            "ipdroid/stuck/M": "fe74f32c2c22e19487078efecdf114b8c8d76fb15a6269f235175007204b94fc",
            "ipdroid/stuck/S": "fe74f32c2c22e19487078efecdf114b8c8d76fb15a6269f235175007204b94fc",
            "ipdroid/turn/L": "f878558eea9a69aa22d20674958a4767ce81f4375b3bb581c7f020a8f6c27c3b",
            "ipdroid/turn/M": "f878558eea9a69aa22d20674958a4767ce81f4375b3bb581c7f020a8f6c27c3b",
            "ipdroid/turn/S": "f878558eea9a69aa22d20674958a4767ce81f4375b3bb581c7f020a8f6c27c3b",
            "ipdroid/working/L": "12adcb08dc889648d328c4ff9f6a37490e20183ed95d74126577452476e2553b",
            "ipdroid/working/M": "12adcb08dc889648d328c4ff9f6a37490e20183ed95d74126577452476e2553b",
            "ipdroid/working/S": "12adcb08dc889648d328c4ff9f6a37490e20183ed95d74126577452476e2553b",
            "ragdoll/idle/L": "6c1dc7846b394992cc0d37dc0bd4381c8e44739be48a71a2c4a2ca0bc400cac9",
            "ragdoll/idle/M": "6c1dc7846b394992cc0d37dc0bd4381c8e44739be48a71a2c4a2ca0bc400cac9",
            "ragdoll/idle/S": "6c1dc7846b394992cc0d37dc0bd4381c8e44739be48a71a2c4a2ca0bc400cac9",
            "ragdoll/stuck/L": "319053ad3b8512399629ffa5c37f0467dc52ea1f998983b8af616ea99edb901f",
            "ragdoll/stuck/M": "319053ad3b8512399629ffa5c37f0467dc52ea1f998983b8af616ea99edb901f",
            "ragdoll/stuck/S": "319053ad3b8512399629ffa5c37f0467dc52ea1f998983b8af616ea99edb901f",
            "ragdoll/turn/L": "0de0bb1bc0eb63445bed159c31f0a4d3948058f5ae7f7c11f4c1350bc39c90cb",
            "ragdoll/turn/M": "cb3d0969d7fd4ddd7f1c2d3520fce1afb64168bcf3d2eefc7eb94ea25730d64a",
            "ragdoll/turn/S": "cb3d0969d7fd4ddd7f1c2d3520fce1afb64168bcf3d2eefc7eb94ea25730d64a",
            "ragdoll/working/L": "6c1dc7846b394992cc0d37dc0bd4381c8e44739be48a71a2c4a2ca0bc400cac9",
            "ragdoll/working/M": "6c1dc7846b394992cc0d37dc0bd4381c8e44739be48a71a2c4a2ca0bc400cac9",
            "ragdoll/working/S": "6c1dc7846b394992cc0d37dc0bd4381c8e44739be48a71a2c4a2ca0bc400cac9",
            "tuxedo/idle/L": "fd956949aa6709c60b27d0948f14b420672eb84f6d8d918622b5d875acc74311",
            "tuxedo/idle/M": "fd956949aa6709c60b27d0948f14b420672eb84f6d8d918622b5d875acc74311",
            "tuxedo/idle/S": "fd956949aa6709c60b27d0948f14b420672eb84f6d8d918622b5d875acc74311",
            "tuxedo/stuck/L": "aac0169e26bd684aeffc20aec97c7702e87361f5bda946dac65fed6e8d26c455",
            "tuxedo/stuck/M": "aac0169e26bd684aeffc20aec97c7702e87361f5bda946dac65fed6e8d26c455",
            "tuxedo/stuck/S": "aac0169e26bd684aeffc20aec97c7702e87361f5bda946dac65fed6e8d26c455",
            "tuxedo/turn/L": "1c1fc51ce5b14f44086f0b351c3c4628551cb224d1ba5ff8ed4da22a4f8fb01c",
            "tuxedo/turn/M": "6e2d28462582683e7e778ea0d3b9e8e828d0f1d84bde134bd0e1896befae4a66",
            "tuxedo/turn/S": "6e2d28462582683e7e778ea0d3b9e8e828d0f1d84bde134bd0e1896befae4a66",
            "tuxedo/working/L": "fd956949aa6709c60b27d0948f14b420672eb84f6d8d918622b5d875acc74311",
            "tuxedo/working/M": "fd956949aa6709c60b27d0948f14b420672eb84f6d8d918622b5d875acc74311",
            "tuxedo/working/S": "fd956949aa6709c60b27d0948f14b420672eb84f6d8d918622b5d875acc74311",
          }
        `);
    });
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
