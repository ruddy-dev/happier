import * as React from 'react';
import { Platform } from 'react-native';
import { usePathname } from 'expo-router';
import { useUnistyles } from 'react-native-unistyles';
import { useAuth } from '@/auth/context/AuthContext';
import { DESK_HAPPIER_PAGE_ROUTES } from '../fonts/deskFont';
import { DeskPageScope } from './DeskPageScope';

/** The app's modal host is a sibling of the page, so it needs the same explicit opt-in. */
export function DeskPageModalAppearance({ children }: React.PropsWithChildren) {
    const pathname = usePathname();
    const { theme } = useUnistyles();
    const auth = useAuth();
    const enabled = Platform.OS === 'web'
        && DESK_HAPPIER_PAGE_ROUTES.includes(pathname)
        && (pathname !== '/' || !auth.isAuthenticated);
    return enabled
        ? <DeskPageScope name={theme.dark ? 'deskPageDark' : 'deskPageLight'}>{children}</DeskPageScope>
        : <>{children}</>;
}
