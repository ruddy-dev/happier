import { describe, expect, it } from 'vitest';
import { terminalPalettes } from '../palette';
import { deskPageThemes, resolveDeskPageTheme } from './deskPageThemes';

describe('pass-through page theme', () => {
    it.each(Object.keys(terminalPalettes) as Array<keyof typeof terminalPalettes>)('uses %s terminal colours independently of Happier mode', (palette) => {
        const name = resolveDeskPageTheme('terminal', palette, false);
        expect(resolveDeskPageTheme('terminal', palette, true)).toBe(name);
        const theme = deskPageThemes[name];
        expect(theme.colors.background.canvas).toBe(terminalPalettes[palette].bg);
        expect(theme.colors.input.background).toBe(terminalPalettes[palette].panel);
        expect(theme.colors.text.primary).toBe(terminalPalettes[palette].ink);
    });
    it('retains the existing Slip scopes', () => {
        expect(resolveDeskPageTheme('mask', 'tokyo', false)).toBe('deskPageLight');
        expect(resolveDeskPageTheme('mask', 'tokyo', true)).toBe('deskPageDark');
    });
});

it('keeps welcome text legible on its opaque page-canvas backing in every page theme', () => {
    const luminance = (hex: string) => {
        const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
            .map((v) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
        return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    };
    for (const [name, theme] of Object.entries(deskPageThemes)) {
        const background = luminance(theme.colors.background.canvas);
        for (const foreground of [theme.colors.text.primary, theme.colors.text.secondary]) {
            const text = luminance(foreground);
            const ratio = (Math.max(text, background) + 0.05) / (Math.min(text, background) + 0.05);
            console.info(`${name}: ${foreground} on ${theme.colors.background.canvas} = ${ratio.toFixed(2)}:1`);
            expect(ratio).toBeGreaterThanOrEqual(4.5);
        }
    }
});
