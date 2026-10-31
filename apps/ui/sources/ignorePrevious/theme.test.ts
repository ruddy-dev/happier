import { describe, expect, it } from 'vitest';

import { BUILT_IN_THEME_PROFILES, getBuiltInThemeProfileDefinition } from '@/theme/profiles/builtInThemeProfiles';
import { parseThemeColor, themeContrastRatio } from '@/theme/themeContrastMath';

const contrast = (ink: string | undefined, background: string | undefined): number => {
    if (!ink || !background) throw new Error('missing token');
    return themeContrastRatio(parseThemeColor(ink), parseThemeColor(background));
};

const tokensFor = (mode: 'dark' | 'light'): Record<string, string | undefined> => {
    const presetId = mode === 'dark' ? 'ignorePrevious' : 'ignorePreviousLight';
    return getBuiltInThemeProfileDefinition(presetId)?.profile.overrides[mode] ?? {};
};

describe('Ignore Previous theme profile', () => {
    // The theme pickers only offer a preset in the slot matching its preferredMode, so each mode needs its own preset.
    it.each([
        ['ignorePrevious', 'ignorePrevious.themeName', 'dark'],
        ['ignorePreviousLight', 'ignorePrevious.themeNameLight', 'light'],
    ] as const)('offers %s as a read-only, cloneable %s preset', (presetId, translationKey, preferredMode) => {
        expect(BUILT_IN_THEME_PROFILES.map((definition) => definition.presetId)).toContain(presetId);
        expect(getBuiltInThemeProfileDefinition(presetId)).toMatchObject({
            translationKey,
            preferredMode,
            cloneable: true,
            editable: false,
            deletable: false,
        });
    });

    it('uses the brand ink and yellow', () => {
        expect(tokensFor('dark')).toMatchObject({
            'background.canvas': '#0b0b0e',
            'surface.base': '#14161c',
            'text.primary': '#f3ecd8',
            'state.warning.foreground': '#ffcf1f',
            'state.danger.foreground': '#ff5a45',
        });
        expect(tokensFor('light')).toMatchObject({
            'background.canvas': '#e9e3d0',
            'surface.base': '#f6f1e3',
            'text.primary': '#14161c',
            'state.danger.foreground': '#c9230f',
        });
    });

    it.each(['dark', 'light'] as const)('keeps body text readable in %s mode', (mode) => {
        const tokens = tokensFor(mode);
        expect(contrast(tokens['text.primary'], tokens['background.canvas'])).toBeGreaterThanOrEqual(4.5);
        expect(contrast(tokens['text.secondary'], tokens['surface.base'])).toBeGreaterThanOrEqual(4.5);
        expect(contrast(tokens['state.danger.foreground'], tokens['surface.base'])).toBeGreaterThanOrEqual(4.5);
    });

    // The wide "Start New Session" button paints fab.background but labels it with the primary-button
    // foreground, so both backgrounds must carry that label.
    it.each(['dark', 'light'] as const)('keeps primary-button labels readable on buttons and the wide FAB in %s mode', (mode) => {
        const tokens = tokensFor(mode);
        const label = tokens['control.button.primary.foreground'];
        expect(contrast(label, tokens['control.button.primary.background'])).toBeGreaterThanOrEqual(4.5);
        expect(contrast(label, tokens['control.fab.background'])).toBeGreaterThanOrEqual(4.5);
        expect(contrast(tokens['control.fab.foreground'], tokens['control.fab.background'])).toBeGreaterThanOrEqual(4.5);
    });
});
