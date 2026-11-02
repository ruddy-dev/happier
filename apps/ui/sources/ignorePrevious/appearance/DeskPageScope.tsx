import * as React from 'react';
import { ScopedTheme } from 'react-native-unistyles';
import { DeskPageThemeContext } from './deskPageThemeContext';
import type { DeskPageThemeName } from './deskPageThemes';

export function DeskPageScope({ name, children }: Readonly<{ name: DeskPageThemeName; children: React.ReactNode }>) {
    return (
        <DeskPageThemeContext.Provider value={name}>
            <ScopedTheme name={name}>{children}</ScopedTheme>
        </DeskPageThemeContext.Provider>
    );
}

/** Body portals retain React context but need to re-establish Unistyles' CSS-variable scope. */
export function DeskPagePortalScope({ children }: React.PropsWithChildren) {
    const name = React.useContext(DeskPageThemeContext);
    return name ? <ScopedTheme name={name}>{children}</ScopedTheme> : <>{children}</>;
}
