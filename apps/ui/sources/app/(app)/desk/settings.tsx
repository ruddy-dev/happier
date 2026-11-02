import * as React from 'react';
import { Stack } from 'expo-router';

import { DeskSettingsScreen } from '@/ignorePrevious/screens/DeskSettingsScreen';
import { t } from '@/text';

export default function DeskSettingsPage() {
    const title = t('ignorePrevious.settings.title');
    const options = React.useMemo(() => ({ title, headerShown: false }) as const, [title]);
    return (
        <>
            <Stack.Screen options={options} />
            <DeskSettingsScreen />
        </>
    );
}
