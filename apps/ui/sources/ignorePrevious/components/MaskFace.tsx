import * as React from 'react';
import Svg, { Circle, G, Path, Rect } from 'react-native-svg';

import type { Bulb } from '../model/bulb';
import { bulbColour, useIpColours } from '../palette';

export type MaskFaceProps = Readonly<{
    size: number;
    /** `'rest'` is the coordinator's own mask: a red bulb, as in the mockups. */
    bulb: Bulb | 'rest';
    /** Half-closed eyes for a worker that is busy or idle; open eyes when it wants you. */
    sleepy: boolean;
    testID?: string;
}>;

/**
 * The Ignore Previous robot mask, drawn from the mockup's face. Static on purpose: no looping
 * animation (apps/ui/AGENTS.md). State shows through the bulb colour and the eyes.
 */
export const MaskFace = React.memo(function MaskFace({ size, bulb, sleepy, testID }: MaskFaceProps) {
    const colours = useIpColours();
    // The mask bulb sits on ink, never on the page, so turn keeps brand yellow (ATR-32).
    const fill = bulb === 'rest' ? colours.red : bulb === 'turn' ? colours.yellow : bulbColour(colours, bulb);
    const ink = colours.ink;

    return (
        <Svg width={size} height={size * 1.08} viewBox="0 -8 100 108" testID={testID} accessible={false}>
            <G fill={colours.bone} stroke={colours.bone} strokeWidth={6} strokeLinejoin="round">
                <Rect x={47} y={18} width={6} height={12} />
                <Circle cx={50} cy={12} r={9} />
                <Rect x={8} y={28} width={84} height={66} rx={20} />
            </G>
            <G fill={ink}>
                <Rect x={47} y={18} width={6} height={12} />
                <Circle cx={50} cy={12} r={9} />
                <Rect x={8} y={28} width={84} height={66} rx={20} />
            </G>
            <Circle cx={50} cy={12} r={5.5} fill={fill} testID={`ip-bulb-${bulb}`} />
            <Rect x={16} y={36} width={68} height={50} rx={15} fill={colours.visor} />
            {bulb === 'stuck' ? (
                <Path d="M29 47l14 14M43 47L29 61M57 47l14 14M71 47L57 61" stroke={ink} strokeWidth={5} strokeLinecap="round" />
            ) : sleepy ? (
                <G fill={ink}>
                    <Path d="M28 50h16v3a8 8 0 0 1-16 0z" />
                    <Path d="M56 50h16v3a8 8 0 0 1-16 0z" />
                    <Rect x={26} y={47} width={20} height={4} rx={2} />
                    <Rect x={54} y={47} width={20} height={4} rx={2} />
                </G>
            ) : (
                <G fill={ink}>
                    <Circle cx={36} cy={54} r={8} />
                    <Circle cx={64} cy={54} r={8} />
                </G>
            )}
        </Svg>
    );
});
