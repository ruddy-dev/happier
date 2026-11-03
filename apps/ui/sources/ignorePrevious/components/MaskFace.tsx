import * as React from 'react';
import Svg, { Circle, G, Path, Rect } from 'react-native-svg';

import type { Bulb } from '../model/bulb';
import { bulbColour, useIpColours, type IpColours } from '../palette';

export type MaskFaceProps = Readonly<{
    size: number;
    bulb: Bulb | 'rest';
    testID?: string;
    colours?: IpColours;
    shadow?: boolean;
}>;

/** The coordinator's drawn mask from mockup 12. The bulb carries the live state. */
export const MaskFace = React.memo(function MaskFace({ size, bulb, testID, colours: override, shadow = false }: MaskFaceProps) {
    const defaultColours = useIpColours();
    const colours = override ?? defaultColours;
    const fill = bulb === 'rest' ? colours.red : bulb === 'turn' ? colours.yellow : bulbColour(colours, bulb);
    const ink = colours.ink;

    return (
        <Svg width={size} height={size * 1.08} viewBox="40 -40 920 1040" testID={testID} accessible={false} style={shadow ? { overflow: 'visible' } : undefined}>
            {shadow ? <G fill={ink} stroke={ink} strokeWidth={44} strokeLinejoin="round" opacity={colours.bone === ink ? 0.35 : 1} transform="translate(60 60)">
                <Rect x={471} y={248} width={58} height={104} />
                <Circle cx={500} cy={164} r={121} />
                <Rect x={100} y={320} width={800} height={630} rx={169} />
            </G> : null}
            <G fill={colours.bone} stroke={colours.bone} strokeWidth={44} strokeLinejoin="round">
                <Rect x={471} y={248} width={58} height={104} />
                <Circle cx={500} cy={164} r={121} />
                <Rect x={100} y={320} width={800} height={630} rx={169} />
            </G>
            <G fill={ink}>
                <Rect x={471} y={248} width={58} height={104} />
                <Circle cx={500} cy={164} r={121} />
                <Rect x={100} y={320} width={800} height={630} rx={169} />
            </G>
            <Circle cx={500} cy={164} r={59} fill={fill} testID={`ip-bulb-${bulb}`} />
            <Rect x={178} y={403} width={644} height={462} rx={130} fill={colours.visor} />
            <G fill={ink}>
                <Path d="M232 616H470v47c0 77-48 132-119 132s-119-55-119-132z" />
                <Rect x={220} y={596} width={262} height={44} rx={22} />
                <Path d="M530 616h238v47c0 77-48 132-119 132s-119-55-119-132z" />
                <Rect x={518} y={596} width={262} height={44} rx={22} />
            </G>
            <G fill={colours.visor}>
                <Path d="M290 665c13 41 38 67 72 67 37 0 65-29 70-74h-48c-4 20-16 31-35 31-22 0-39-8-59-24z" />
                <Path d="M588 665c13 41 38 67 72 67 37 0 65-29 70-74h-48c-4 20-16 31-35 31-22 0-39-8-59-24z" />
            </G>
        </Svg>
    );
});
