import { ignorePreviousLightProfile, ignorePreviousProfile } from '@/theme/profiles/ignorePreviousThemeProfile';
import { resolveThemeProfile } from '@/theme/profiles/resolveThemeProfile';
import { terminalPalettes, type TerminalPalette } from '../palette';
import type { ChatStyle } from '../deskPrefs';

// Reuse the existing semantic theme resolver so upstream components receive the same palette.
function terminalTheme(palette: TerminalPalette) {
    const paint = terminalPalettes[palette];
    const light = palette === 'terminalPaper';
    const mode = light ? 'light' : 'dark';
    const base = light ? ignorePreviousLightProfile : ignorePreviousProfile;
    return resolveThemeProfile({ mode, profile: {
        ...base,
        overrides: { ...base.overrides, [mode]: {
            ...base.overrides[mode],
            'background.canvas': paint.bg,
            'surface.base': paint.panel,
            'surface.inset': paint.bg,
            'surface.elevated': paint.panel2,
            'surface.selected': paint.sel,
            'surface.pressed': paint.panel2,
            'border.default': paint.edge,
            'border.surface': paint.rule,
            'border.strong': paint.edge,
            'border.modal': paint.edge,
            'chrome.header.background': paint.panel,
            'chrome.header.foreground': paint.ink,
            'text.primary': paint.ink,
            'text.secondary': paint.mute,
            'text.tertiary': paint.mute,
            'text.placeholder': paint.mute,
            'text.link': paint.user,
            'state.active.foreground': paint.user,
            'control.button.primary.background': paint.ink,
            'control.button.primary.foreground': paint.bg,
            'control.input.background': paint.panel,
            'control.input.foreground': paint.ink,
            'control.input.placeholder': paint.mute,
        } },
    } });
}

export const deskPageThemes = {
    deskPageLight: resolveThemeProfile({ mode: 'light', profile: ignorePreviousLightProfile }),
    deskPageDark: resolveThemeProfile({ mode: 'dark', profile: ignorePreviousProfile }),
    deskPageTokyo: terminalTheme('tokyo'),
    deskPageKanagawa: terminalTheme('kanagawa'),
    deskPageGruvbox: terminalTheme('gruvbox'),
    deskPageDracula: terminalTheme('dracula'),
    deskPageTerminalPaper: terminalTheme('terminalPaper'),
};

export type DeskPageThemeName = keyof typeof deskPageThemes;
const terminalNames: Record<TerminalPalette, DeskPageThemeName> = {
    tokyo: 'deskPageTokyo', kanagawa: 'deskPageKanagawa', gruvbox: 'deskPageGruvbox',
    dracula: 'deskPageDracula', terminalPaper: 'deskPageTerminalPaper',
};
export function resolveDeskPageTheme(style: ChatStyle, palette: TerminalPalette, dark: boolean): DeskPageThemeName {
    return style === 'terminal' ? terminalNames[palette] : dark ? 'deskPageDark' : 'deskPageLight';
}
