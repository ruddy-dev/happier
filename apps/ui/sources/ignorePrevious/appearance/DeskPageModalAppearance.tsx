import * as React from 'react';
import { Platform } from 'react-native';
import { usePathname } from 'expo-router';
import { useUnistyles } from 'react-native-unistyles';
import { useAuth } from '@/auth/context/AuthContext';
import { DESK_HAPPIER_PAGE_ROUTES } from '../fonts/deskFont';
import { DeskPageScope } from './DeskPageScope';
import { resolveDeskPageTheme, type DeskPageThemeName } from './deskPageThemes';
import { useDeskPref } from '../deskPrefs';

/** Mounted once per dialog by the modal host; navigation cannot change its appearance. */
export function DeskPageModalAppearance({ children }: React.PropsWithChildren) {
    const pathname = usePathname();
    const { theme } = useUnistyles();
    const auth = useAuth();
    const [style] = useDeskPref('chatStyle');
    const [palette] = useDeskPref('terminalPalette');
    const [name] = React.useState<DeskPageThemeName | null>(() => {
        const enabled = Platform.OS === 'web'
            && DESK_HAPPIER_PAGE_ROUTES.includes(pathname)
            && (pathname !== '/' || !auth.isAuthenticated);
        return enabled ? resolveDeskPageTheme(style, palette, theme.dark) : null;
    });
    return name
        ? <DeskPageScope name={name}>{children}</DeskPageScope>
        : <>{children}</>;
}
