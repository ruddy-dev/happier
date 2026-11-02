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
    'ring/violet/night/turn', // Accepted exception (ATR-32, option B)
    'ring/violet/night/working', // Accepted exception (ATR-32, option B)
    'ring/orange/night/turn', // Accepted exception (ATR-32, option B)
    'ring/orange/night/stuck', // Accepted exception (ATR-32, option B)
    'body/violet/paper/bg', // Accepted exception (ATR-32, option B)
    'body/violet/paper/panel', // Accepted exception (ATR-32, option B)
    'ring/violet/paper/turn', // Accepted exception (ATR-32, option B)
    'ring/orange/paper/turn', // Accepted exception (ATR-32, option B)
    'ring/violet/tokyo/turn', // Accepted exception (ATR-32, option B)
    'ring/violet/tokyo/working', // Accepted exception (ATR-32, option B)
    'ring/orange/tokyo/turn', // Accepted exception (ATR-32, option B)
    'ring/blue/tokyo/working', // Accepted exception (ATR-32, option B)
    'ring/violet/kanagawa/turn', // Accepted exception (ATR-32, option B)
    'ring/orange/kanagawa/turn', // Accepted exception (ATR-32, option B)
    'ring/orange/kanagawa/stuck', // Accepted exception (ATR-32, option B)
    'ring/magenta/kanagawa/stuck', // Accepted exception (ATR-32, option B)
    'ring/violet/gruvbox/turn', // Accepted exception (ATR-32, option B)
    'ring/orange/gruvbox/turn', // Accepted exception (ATR-32, option B)
    'ring/violet/dracula/turn', // Accepted exception (ATR-32, option B)
    'ring/orange/dracula/turn', // Accepted exception (ATR-32, option B)
    'body/violet/terminalPaper/bg', // Accepted exception (ATR-32, option B)
    'body/violet/terminalPaper/panel', // Accepted exception (ATR-32, option B)
    'ring/violet/terminalPaper/turn', // Accepted exception (ATR-32, option B)
    'ring/orange/terminalPaper/turn', // Accepted exception (ATR-32, option B)
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
                    const signal = state === 'turn' ? theme.turnSignal : state === 'idle' ? theme.idleSignal : theme[token];
                    expect(contrast(signal, theme[surface])).toBeGreaterThanOrEqual(3);
                });
            }
        }
    }
});

describe('ATR-32 option B: dark themes keep the brand turn yellow', () => {
    for (const name of ['night', 'tokyo', 'kanagawa', 'gruvbox', 'dracula'] as const) {
        it(`${name} turnSignal is its yel`, () => {
            expect(palette.deskThemes[name].turnSignal).toBe(palette.deskThemes[name].yel);
        });
    }
});

// Existing mask, label, count and issue-dot consumers use this palette adapter.
describe('bulb signals on the corresponding desk surfaces', () => {
    it('uses the supplied turn signal independently of brand paint', () => {
        const colours = { ...palette.ipPalette.light, turnSignal: palette.deskThemes.paper.idleSignal };
        expect(palette.bulbColour(colours, 'turn')).toBe(colours.turnSignal);
    });
    for (const [mode, name] of [['dark', 'night'], ['light', 'paper']] as const) {
        for (const state of ['idle', 'turn'] as const) {
            for (const surface of surfaces) {
                it(`${mode}/${state}/${surface} meets 3:1`, () => {
                    expect(contrast(palette.bulbColour(palette.ipPalette[mode], state), palette.deskThemes[name][surface])).toBeGreaterThanOrEqual(3);
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
                    // Accepted exception (ATR-32, option B): Paper working rings retain the neutral escape.
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
        expect(contrast(green, teal)).toBeGreaterThanOrEqual(2);
    });
});
