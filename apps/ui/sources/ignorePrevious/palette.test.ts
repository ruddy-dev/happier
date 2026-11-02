import { describe, expect, it } from 'vitest';
import * as palette from './palette';

describe('desk palette data', () => {
    it('provides the seven approved desk themes', () => {
        expect(palette).toHaveProperty('deskThemes');
        expect(Object.keys(palette.deskThemes)).toEqual(['night', 'paper', 'tokyo', 'kanagawa', 'gruvbox', 'dracula', 'terminalPaper']);
    });
    it('keeps the round-8 robot choices', () => {
        expect(palette).toHaveProperty('robotColourDefaults');
        expect(palette.robotColourDefaults).toEqual({ droid: 'purple', b: 'blue', prompt: 'green', loupe: 'violet', lab: 'orange' });
    });
});

// WCAG relative luminance from mockup 12's CONTRAST/RC_MATRIX harness.
// These tokens are opaque hex colours; DOM alpha compositing belongs to live QA.
function luminance(colour: string): number {
    const channels = [1, 3, 5].map(i => parseInt(colour.slice(i, i + 2), 16) / 255);
    const linear = channels.map(v => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}
function contrast(a: string, b: string): number {
    const x = luminance(a), y = luminance(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
function hueAndSaturation(colour: string) {
    const [r, g, b] = [1, 3, 5].map(i => parseInt(colour.slice(i, i + 2), 16) / 255);
    const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
    if (!delta) return { hue: 0, saturation: 0 };
    const sector = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
    return { hue: Math.round((sector * 60 + 360) % 360), saturation: delta / (1 - Math.abs(max + min - 1)) };
}
function separatedHue(a: string, b: string, minimum: number): boolean {
    const x = hueAndSaturation(a), y = hueAndSaturation(b), gap = Math.abs(x.hue - y.hue);
    return x.saturation < 0.25 || y.saturation < 0.25 || Math.min(gap, 360 - gap) >= minimum;
}

// Fixed exception list, never inferred from the measured result. ATR-32 rulings.
const knownFailures = new Set([
    'signal/night/idle/bg', // 1.8393:1
    'signal/night/idle/panel', // 1.6922:1
    'signal/night/idle/panel2', // 1.5417:1
    'ring/violet/night/turn', // 2.2493:1
    'ring/violet/night/working', // 1.8739:1
    'ring/orange/night/turn', // 2.6228:1
    'ring/orange/night/stuck', // 1.3754:1
    'signal/paper/turn/bg', // 1.2546:1
    'signal/paper/turn/panel', // 1.2546:1
    'signal/paper/turn/panel2', // 1.4792:1
    'signal/paper/idle/bg', // 1.4307:1
    'signal/paper/idle/panel', // 1.4307:1
    'signal/paper/idle/panel2', // 1.6868:1
    'body/violet/paper/bg', // 2.8219:1
    'body/violet/paper/panel', // 2.8219:1
    'ring/violet/paper/turn', // 2.2493:1
    'ring/orange/paper/turn', // 2.6228:1
    'signal/tokyo/idle/bg', // 1.9976:1
    'signal/tokyo/idle/panel', // 1.8344:1
    'signal/tokyo/idle/panel2', // 1.6661:1
    'ring/violet/tokyo/turn', // 2.2493:1
    'ring/violet/tokyo/working', // 1.9395:1
    'ring/orange/tokyo/turn', // 2.6228:1
    'ring/blue/tokyo/working', // 2.2615:1
    'signal/kanagawa/idle/bg', // 2.1410:1
    'signal/kanagawa/idle/panel', // 1.9753:1
    'signal/kanagawa/idle/panel2', // 1.7571:1
    'ring/violet/kanagawa/turn', // 2.2493:1
    'ring/orange/kanagawa/turn', // 2.6228:1
    'ring/orange/kanagawa/stuck', // 1.2083:1
    'ring/magenta/kanagawa/stuck', // 1.1984:1
    'signal/gruvbox/idle/bg', // 1.8582:1
    'signal/gruvbox/idle/panel', // 1.6709:1
    'signal/gruvbox/idle/panel2', // 1.4880:1
    'ring/violet/gruvbox/turn', // 2.2493:1
    'ring/orange/gruvbox/turn', // 2.6228:1
    'signal/dracula/idle/bg', // 2.3389:1
    'signal/dracula/idle/panel', // 2.1092:1
    'signal/dracula/idle/panel2', // 1.7465:1
    'ring/violet/dracula/turn', // 2.2493:1
    'ring/orange/dracula/turn', // 2.6228:1
    'signal/terminalPaper/turn/bg', // 1.2546:1
    'signal/terminalPaper/turn/panel', // 1.2546:1
    'signal/terminalPaper/turn/panel2', // 1.4792:1
    'signal/terminalPaper/idle/bg', // 1.4307:1
    'signal/terminalPaper/idle/panel', // 1.4307:1
    'signal/terminalPaper/idle/panel2', // 1.6868:1
    'body/violet/terminalPaper/bg', // 2.8219:1
    'body/violet/terminalPaper/panel', // 2.8219:1
    'ring/violet/terminalPaper/turn', // 2.2493:1
    'ring/orange/terminalPaper/turn', // 2.6228:1
]);
function checkPair(id: string, check: () => void) {
    // A corrected colour becomes an unexpected pass, prompting removal of its ruling.
    (knownFailures.has(id) ? it.fails : it)(id, check);
}
const surfaces = ['bg', 'panel', 'panel2'] as const;

describe('ATR-9 criterion 3: state signal without a sprite, 3:1 graphical bar', () => {
    for (const [name, theme] of Object.entries(palette.deskThemes)) {
        for (const [state, token] of Object.entries(palette.spriteStateTokens)) {
            for (const surface of surfaces) {
                checkPair(`signal/${name}/${state}/${surface}`, () => {
                    expect(contrast(theme[token], theme[surface])).toBeGreaterThanOrEqual(3);
                });
            }
        }
    }
});

describe('round-8 robot contrast in all seven themes', () => {
    for (const [name, theme] of Object.entries(palette.deskThemes)) {
        for (const key of Object.keys(palette.robotPresets) as palette.RobotPreset[]) {
            const body = palette.robotPresets[key].body;
            for (const surface of surfaces) {
                checkPair(`body/${key}/${name}/${surface}`, () => {
                    expect(contrast(body, theme[surface])).toBeGreaterThanOrEqual(3);
                });
                it(`ASCII/${key}/${name}/${surface} meets 4.5:1`, () => {
                    expect(contrast(theme.robotInk[key], theme[surface])).toBeGreaterThanOrEqual(4.5);
                });
            }
            for (const state of ['turn', 'stuck', 'working'] as const) {
                checkPair(`ring/${key}/${name}/${state}`, () => {
                    const ring = theme[palette.spriteStateTokens[state]];
                    const ratio = contrast(body, ring);
                    const strict = name === 'night' || name === 'tokyo';
                    const passes = state === 'turn' ? ratio >= 2.5 && separatedHue(body, ring, 90)
                        : state === 'stuck' ? ratio >= 1.4 || separatedHue(body, ring, 60)
                        : strict ? ratio >= 2 && separatedHue(body, ring, 45)
                        : ratio >= 1.4 || separatedHue(body, ring, 60);
                    expect(passes, `${body} against ${ring}: ${ratio.toFixed(4)}:1`).toBe(true);
                });
            }
        }
        for (const [kind, ink] of Object.entries(theme.spriteInk)) {
            for (const surface of surfaces) {
                it(`ASCII/${kind}/${name}/${surface} meets 4.5:1`, () => {
                    expect(contrast(ink, theme[surface])).toBeGreaterThanOrEqual(4.5);
                });
            }
        }
    }
    it('Kanagawa working signal remains distinct from Codex green', () => {
        const green = palette.robotPresets.green.body, teal = palette.deskThemes.kanagawa.work;
        expect(contrast(green, teal)).toBeGreaterThanOrEqual(1.4);
        expect(separatedHue(green, teal, 45)).toBe(true);
    });
});
