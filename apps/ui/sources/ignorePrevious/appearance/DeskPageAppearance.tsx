import * as React from 'react';
import { Platform, View } from 'react-native';
import { Stack } from 'expo-router';
import { useUnistyles } from 'react-native-unistyles';
import type { NativeStackHeaderProps } from '@react-navigation/native-stack';

import { createHeader } from '@/components/navigation/Header';
import { DeskFontRoot } from '../fonts/DeskFontRoot';
import { DeskPageScope } from './DeskPageScope';
import { deskPageFontStyle } from './deskPageThemeContext';
import { useDeskPref } from '../deskPrefs';
import { resolveDeskPageTheme, type DeskPageThemeName } from './deskPageThemes';

// Navigation renders its header outside the screen's React tree.
function DeskPageHeader({ name, ...props }: NativeStackHeaderProps & { name: DeskPageThemeName }) {
    return (
        <DeskPageScope name={name}>
            {createHeader(props)}
        </DeskPageScope>
    );
}

function DeskPageContent({ children, withHeader, name }: React.PropsWithChildren<{ withHeader: boolean; name: DeskPageThemeName }>) {
    const { theme } = useUnistyles();
    return (
        <>
            {withHeader && <Stack.Screen options={{
                header: (props) => <DeskPageHeader {...props} name={name} />,
                headerStyle: { backgroundColor: theme.colors.chrome.header.background },
                headerTintColor: theme.colors.chrome.header.foreground,
                headerTitleStyle: { color: theme.colors.chrome.header.foreground, ...deskPageFontStyle },
                contentStyle: { backgroundColor: theme.colors.background.canvas },
            }} />}
            <View style={{ flex: 1, minHeight: 0, backgroundColor: theme.colors.background.canvas }}>
                {children}
            </View>
        </>
    );
}

/** Mount on the three page entries, with sign-in confined to Home's unauthenticated branch. */
export function DeskPageAppearance({ children, withHeader = true, page }: React.PropsWithChildren<{ withHeader?: boolean; page?: 'voice' }>) {
    const { theme } = useUnistyles();
    const [style] = useDeskPref('chatStyle');
    const [palette] = useDeskPref('terminalPalette');
    const name = resolveDeskPageTheme(style, palette, theme.dark);
    if (Platform.OS !== 'web') return <>{children}</>;
    return (
        <DeskFontRoot>
            <DeskPageScope name={name} page={page}>
                <DeskPageContent withHeader={withHeader} name={name}>{children}</DeskPageContent>
            </DeskPageScope>
        </DeskFontRoot>
    );
}
