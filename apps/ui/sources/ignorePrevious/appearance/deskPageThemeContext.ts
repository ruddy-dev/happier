import { createContext } from 'react';
import { DESK_FONT_STACK } from '../fonts/deskFont';
import type { DeskPageThemeName } from './deskPageThemes';

/** Null preserves Happier typography everywhere outside an opted-in page. */
export const DeskPageThemeContext = createContext<DeskPageThemeName | null>(null);
export const deskPageFontStyle = { fontFamily: DESK_FONT_STACK };
