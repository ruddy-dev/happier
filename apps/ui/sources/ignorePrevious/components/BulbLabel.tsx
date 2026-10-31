import * as React from 'react';
import { View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';

import { Text } from '@/components/ui/text/Text';
import { t } from '@/text';

import type { Bulb } from '../model/bulb';
import { bulbColour, useIpColours } from '../palette';

/** The word for a bulb state, so state never rests on colour alone. */
export function bulbWord(bulb: Bulb): string {
    switch (bulb) {
        case 'turn':
            return t('ignorePrevious.countTurn');
        case 'stuck':
            return t('ignorePrevious.countStuck');
        case 'working':
            return t('ignorePrevious.countWorking');
        case 'idle':
            return t('ignorePrevious.countIdle');
    }
}

/** A small bulb-coloured dot with its state word. The desk's lightweight stand-in for a mask face. */
export const BulbLabel = React.memo(function BulbLabel({ bulb, size = 10 }: { bulb: Bulb; size?: number }) {
    const { theme } = useUnistyles();
    const colours = useIpColours();
    return (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <View
                testID={`ip-bulb-${bulb}`}
                style={{
                    width: size,
                    height: size,
                    borderRadius: size / 2,
                    backgroundColor: bulbColour(colours, bulb),
                    borderWidth: bulb === 'idle' ? 1 : 0,
                    borderColor: theme.colors.border.strong,
                }}
            />
            <Text style={{ color: theme.colors.text.secondary, fontSize: 12 }}>{bulbWord(bulb)}</Text>
        </View>
    );
});
