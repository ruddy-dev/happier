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
