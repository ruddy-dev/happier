import * as React from 'react';
import { ScopedTheme, useUnistyles } from 'react-native-unistyles';
import { Platform } from 'react-native';
import { mountDeskFont } from '../fonts/deskFont';
import { DeskPageThemeContext, DeskVoicePageContext } from './deskPageThemeContext';
import type { DeskPageThemeName } from './deskPageThemes';

function PageFocusScope({ children, name }: React.PropsWithChildren<{ name: DeskPageThemeName }>) {
    const { theme } = useUnistyles();
    const voice = React.useContext(DeskVoicePageContext);
    if (Platform.OS !== 'web') return <>{children}</>;
    return <div data-ip-page-scope="" data-ip-voice={voice ? '' : undefined} data-ip-terminal={name !== 'deskPageLight' && name !== 'deskPageDark' ? '' : undefined} style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, minHeight: 0, '--ip-page-focus': theme.colors.text.primary, '--ip-page-surface': theme.colors.background.canvas } as React.CSSProperties}>{children}</div>;
}

export function DeskPageScope({ name, page, children }: Readonly<{ name: DeskPageThemeName; page?: 'voice'; children: React.ReactNode }>) {
    // A retained page or open dialog can outlive the current route's font root.
    React.useEffect(() => {
        if (typeof document !== 'undefined') return mountDeskFont(document);
    }, []);
    return (
        <DeskVoicePageContext.Provider value={page === 'voice'}>
            <DeskPageThemeContext.Provider value={name}>
                <ScopedTheme name={name}><PageFocusScope name={name}>{children}</PageFocusScope></ScopedTheme>
            </DeskPageThemeContext.Provider>
        </DeskVoicePageContext.Provider>
    );
}

/** Body portals retain React context but need to re-establish Unistyles' CSS-variable scope. */
export function DeskPagePortalScope({ children }: React.PropsWithChildren) {
    const name = React.useContext(DeskPageThemeContext);
    return name ? <ScopedTheme name={name}><PageFocusScope name={name}>{children}</PageFocusScope></ScopedTheme> : <>{children}</>;
}

/** Only web Terminal Voice uses the pass-through page's tight geometry. */
export function useTerminalVoicePage(): boolean {
    const voice = React.useContext(DeskVoicePageContext);
    const name = React.useContext(DeskPageThemeContext);
    return Platform.OS === 'web' && voice && name !== null && name !== 'deskPageLight' && name !== 'deskPageDark';
}
