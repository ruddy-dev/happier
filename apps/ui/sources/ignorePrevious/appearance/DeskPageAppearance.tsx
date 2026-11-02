import * as React from 'react';
import { Platform, View } from 'react-native';
import { Stack } from 'expo-router';
import { useUnistyles } from 'react-native-unistyles';
import type { NativeStackHeaderProps } from '@react-navigation/native-stack';

import { createHeader } from '@/components/navigation/Header';
import { DeskFontRoot } from '../fonts/DeskFontRoot';
import { DeskPageScope } from './DeskPageScope';
import { deskPageFontStyle } from './deskPageThemeContext';

// Navigation renders its header outside the screen's React tree.
function DeskPageHeader(props: NativeStackHeaderProps) {
    const { theme } = useUnistyles();
    return (
        <DeskPageScope name={theme.dark ? 'deskPageDark' : 'deskPageLight'}>
            {createHeader(props)}
        </DeskPageScope>
    );
}

function renderDeskPageHeader(props: NativeStackHeaderProps) {
    return <DeskPageHeader {...props} />;
}

function DeskPageContent({ children, withHeader }: React.PropsWithChildren<{ withHeader: boolean }>) {
    const { theme } = useUnistyles();
    return (
        <>
            {withHeader && <Stack.Screen options={{
                header: renderDeskPageHeader,
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
export function DeskPageAppearance({ children, withHeader = true }: React.PropsWithChildren<{ withHeader?: boolean }>) {
    const { theme } = useUnistyles();
    if (Platform.OS !== 'web') return <>{children}</>;
    return (
        <DeskFontRoot>
            <DeskPageScope name={theme.dark ? 'deskPageDark' : 'deskPageLight'}>
                <DeskPageContent withHeader={withHeader}>{children}</DeskPageContent>
            </DeskPageScope>
        </DeskFontRoot>
    );
}
