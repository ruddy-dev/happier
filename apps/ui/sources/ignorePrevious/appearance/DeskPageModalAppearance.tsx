import * as React from 'react';
import { Platform } from 'react-native';
import { usePathname } from 'expo-router';
import { useUnistyles } from 'react-native-unistyles';
import { useAuth } from '@/auth/context/AuthContext';
import { DESK_HAPPIER_PAGE_ROUTES } from '../fonts/deskFont';
import { DeskPageScope } from './DeskPageScope';
import { resolveDeskPageTheme, type DeskPageThemeName } from './deskPageThemes';
import { useDeskPref } from '../deskPrefs';

/** Produce a wrapper for the current route, captured by the host when a dialog opens. */
export function useDeskPageModalAppearance(): React.ComponentType<React.PropsWithChildren> {
    const pathname = usePathname();
    const { theme } = useUnistyles();
    const auth = useAuth();
    const [style] = useDeskPref('chatStyle');
    const [palette] = useDeskPref('terminalPalette');
    const enabled = Platform.OS === 'web'
        && DESK_HAPPIER_PAGE_ROUTES.includes(pathname)
        && (pathname !== '/' || !auth.isAuthenticated);
    const name: DeskPageThemeName | null = enabled ? resolveDeskPageTheme(style, palette, theme.dark) : null;
    const page = enabled && pathname === '/settings/voice' ? 'voice' : undefined;
    return React.useMemo(() => {
        function ModalAppearance({ children }: React.PropsWithChildren) {
            return name ? <DeskPageScope name={name} page={page}>{children}</DeskPageScope> : <>{children}</>;
        }
        return ModalAppearance;
    }, [name, page]);
}
