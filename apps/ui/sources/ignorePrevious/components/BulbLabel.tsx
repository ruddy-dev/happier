import * as React from 'react';
import { View } from 'react-native';

import { DeskText as Text } from '../typography/DeskText';
import { t } from '@/text';

import type { Bulb } from '../model/bulb';
import { bulbColour, useDeskPaint } from '../palette';

/** The word for a bulb state, so state never rests on colour alone. */
export function bulbWord(bulb: Bulb): string {
    switch (bulb) {
        case 'turn':
            return t('ignorePrevious.countTurn');
        case 'stuck':
            return t('ignorePrevious.countStuck');
        case 'working':
            return t('ignorePrevious.countWorking');
        case 'waiting':
            return t('ignorePrevious.usageLimit.waiting');
        case 'idle':
            return t('ignorePrevious.countIdle');
    }
}

/** A small bulb-coloured dot with its state word. The desk's lightweight stand-in for a mask face. */
export const BulbLabel = React.memo(function BulbLabel({ bulb, size = 10 }: { bulb: Bulb; size?: number }) {
    const { text, strongBorder, colours } = useDeskPaint();
    return (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0, maxWidth: '100%' }}>
            <View
                testID={`ip-bulb-dot-${bulb}`}
                style={{
                    flexShrink: 0,
                    width: size,
                    height: size,
                    borderRadius: size / 2,
                    backgroundColor: bulbColour(colours, bulb),
                    borderWidth: bulb === 'idle' ? 1 : 0,
                    borderColor: strongBorder,
                }}
            />
            <Text numberOfLines={1} ellipsizeMode="tail" style={{ color: text.secondary, fontSize: 12, flexShrink: 1 }}>{bulbWord(bulb)}</Text>
        </View>
    );
});
