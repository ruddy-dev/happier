import * as React from 'react';
import { Platform } from 'react-native';
import { usePathname } from 'expo-router';
import { useUnistyles } from 'react-native-unistyles';
import { useAuth } from '@/auth/context/AuthContext';
import { DESK_HAPPIER_PAGE_ROUTES } from '../fonts/deskFont';
import { DeskPageScope } from './DeskPageScope';
import type { DeskPageThemeName } from './deskPageThemes';

/** Mounted once per dialog by the modal host; navigation cannot change its appearance. */
export function DeskPageModalAppearance({ children }: React.PropsWithChildren) {
    const pathname = usePathname();
    const { theme } = useUnistyles();
    const auth = useAuth();
    const [name] = React.useState<DeskPageThemeName | null>(() => {
        const enabled = Platform.OS === 'web'
            && DESK_HAPPIER_PAGE_ROUTES.includes(pathname)
            && (pathname !== '/' || !auth.isAuthenticated);
        return enabled ? (theme.dark ? 'deskPageDark' : 'deskPageLight') : null;
    });
    return name
        ? <DeskPageScope name={name}>{children}</DeskPageScope>
        : <>{children}</>;
}
