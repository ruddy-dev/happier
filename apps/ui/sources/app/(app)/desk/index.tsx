import * as React from 'react';
import { Stack } from 'expo-router';

import { DeskScreen } from '@/ignorePrevious/screens/DeskScreen';
import { t } from '@/text';

export default function DeskPage() {
    const title = t('ignorePrevious.screenTitle');
    const options = React.useMemo(() => ({ title, headerShown: false }) as const, [title]);
    return (
        <>
            <Stack.Screen options={options} />
            <DeskScreen />
        </>
    );
}
