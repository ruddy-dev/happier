import { ignorePreviousLightProfile, ignorePreviousProfile } from '@/theme/profiles/ignorePreviousThemeProfile';
import { resolveThemeProfile } from '@/theme/profiles/resolveThemeProfile';

/** Named scopes reuse the existing desk profiles without changing Happier's selected theme. */
export const deskPageThemes = {
    deskPageLight: resolveThemeProfile({ mode: 'light', profile: ignorePreviousLightProfile }),
    deskPageDark: resolveThemeProfile({ mode: 'dark', profile: ignorePreviousProfile }),
};

export type DeskPageThemeName = keyof typeof deskPageThemes;
