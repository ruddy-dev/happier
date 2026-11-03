import * as React from 'react';
import { Pressable, View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { t } from '@/text';
import { RobotPicker } from '../components/RobotPicker';
import { DeskText } from '../typography/DeskText';

/** Reopening unmounts the production picker; only explicit local desk preference writes occur. */
export function RobotPickerFixture() {
    const { theme } = useUnistyles();
    const [open, setOpen] = React.useState(false);
    return <View testID="ip-robot-fixture" style={{ padding: 12, gap: 8 }}>
        <Pressable testID="ip-robot-fixture-toggle" accessibilityRole="button" accessibilityState={{ expanded: open }}
            onPress={() => setOpen(value => !value)} style={{ minHeight: 48, justifyContent: 'center' }}>
            <DeskText style={{ color: theme.colors.text.primary }}>{t('ignorePrevious.robots.fixtureTitle')}</DeskText>
        </Pressable>
        {open ? <RobotPicker /> : null}
    </View>;
}
