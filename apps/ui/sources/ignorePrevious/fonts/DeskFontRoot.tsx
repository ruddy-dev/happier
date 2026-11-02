import * as React from 'react';
import { Platform } from 'react-native';
import { usePathname } from 'expo-router';

import { DESK_FONT_ROUTES, mountDeskFont } from './deskFont';

/** Web route root only; explicit Happier Text font families still take precedence. */
export function DeskFontRoot({ children }: Readonly<{ children: React.ReactNode }>) {
    const pathname = usePathname();
    const enabled = Platform.OS === 'web' && DESK_FONT_ROUTES.includes(pathname);
    React.useEffect(() => {
        if (enabled && typeof document !== 'undefined') return mountDeskFont(document);
    }, [enabled]);

    if (Platform.OS !== 'web') return <>{children}</>;
    return (
        <div
            data-ip-font={enabled ? 'desk' : undefined}
            style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, minHeight: 0 }}
        >
            {children}
        </div>
    );
}
