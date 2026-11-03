import * as React from 'react';
import { ScopedTheme, useUnistyles } from 'react-native-unistyles';
import { Platform } from 'react-native';
import { mountDeskFont } from '../fonts/deskFont';
import { DeskPageThemeContext } from './deskPageThemeContext';
import type { DeskPageThemeName } from './deskPageThemes';

function PageFocusScope({ children }: React.PropsWithChildren) {
    const { theme } = useUnistyles();
    if (Platform.OS !== 'web') return <>{children}</>;
    return <div data-ip-page-scope="" style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, minHeight: 0, '--ip-page-focus': theme.colors.text.primary } as React.CSSProperties}>{children}</div>;
}

export function DeskPageScope({ name, children }: Readonly<{ name: DeskPageThemeName; children: React.ReactNode }>) {
    // A retained page or open dialog can outlive the current route's font root.
    React.useEffect(() => {
        if (typeof document !== 'undefined') return mountDeskFont(document);
    }, []);
    return (
        <DeskPageThemeContext.Provider value={name}>
            <ScopedTheme name={name}><PageFocusScope>{children}</PageFocusScope></ScopedTheme>
        </DeskPageThemeContext.Provider>
    );
}

/** Body portals retain React context but need to re-establish Unistyles' CSS-variable scope. */
export function DeskPagePortalScope({ children }: React.PropsWithChildren) {
    const name = React.useContext(DeskPageThemeContext);
    return name ? <ScopedTheme name={name}><PageFocusScope>{children}</PageFocusScope></ScopedTheme> : <>{children}</>;
}
