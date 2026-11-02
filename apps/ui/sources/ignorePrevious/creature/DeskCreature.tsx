import * as React from 'react';
import { View } from 'react-native';
import { MaskFace } from '../components/MaskFace';
import { creatureLabel } from './creatureLabel';
import type { DeskCreatureProps } from './DeskCreature.types';

/** Native has no canvas engine and never starts animation work. Metro selects .web on web. */
export function DeskCreature({ mode, width = '100%', height = 128 }: DeskCreatureProps) {
    return <View testID="ip-creature" accessible accessibilityRole="image" accessibilityLabel={creatureLabel(mode, false)}
        style={{ width, height, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
        <MaskFace size={40} bulb="rest" sleepy />
    </View>;
}
