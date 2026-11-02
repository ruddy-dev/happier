import * as React from 'react';
import { Animated, Easing, View } from 'react-native';
import Svg, { Path, Rect, Text as SvgText } from 'react-native-svg';
import { useReducedMotionPreference } from '@/hooks/ui/useReducedMotionPreference';

import type { Bulb } from '../model/bulb';
import { DESK_FONT_STACK } from '../fonts/deskFont';
import { spriteAsciiColour, spritePixelColour, spriteSignalColour, useDeskPaint } from '../palette';
import { spriteAscii, spriteGrids, type SpriteKind } from '../sprites';

export type WorkerSpriteProps = Readonly<{
    kind: SpriteKind;
    bulb: Bulb;
    /** Card 40, rail/header 28, worker row 24. The grid uses whole-number cell sizes. */
    size: 24 | 28 | 40;
    faceStyle?: 'A' | 'B';
    calm?: boolean;
    testID?: string;
}>;

/** Approved grids and ASCII, a shared steady state cue, and just one finite IPB entrance. */
export const WorkerSprite = React.memo(function WorkerSprite({ kind, bulb, size, faceStyle = 'A', calm = false, testID }: WorkerSpriteProps) {
    const { paint } = useDeskPaint();
    const reducedMotion = useReducedMotionPreference();
    const [progress] = React.useState(() => new Animated.Value(0));
    const working = kind === 'ipb' && bulb === 'working';
    const wasWorking = React.useRef(false);
    React.useEffect(() => {
        const starting = working && !wasWorking.current;
        wasWorking.current = working;
        progress.setValue(0);
        if (!starting || calm || reducedMotion) return;
        // Four 400 ms bobs, returning to zero at each boundary, with no repeat/loop handle.
        const animation = Animated.timing(progress, { toValue: 4, duration: 1600, easing: Easing.linear, useNativeDriver: true });
        animation.start();
        return () => { animation.stop(); progress.setValue(0); };
    }, [working, calm, reducedMotion, progress]);
    const translateY = React.useMemo(() => progress.interpolate({
        inputRange: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4],
        outputRange: [0, Math.round(size * 0.08), 0, Math.round(size * 0.08), 0, Math.round(size * 0.08), 0, Math.round(size * 0.08), 0],
    }), [progress, size]);
    const detail = size === 40 ? 'L' : size === 28 ? 'M' : 'S';
    const cell = Math.floor(size / 16);
    const inset = (size - 16 * cell) / 2;
    const pixels = faceStyle === 'A' ? spriteGrids[kind][bulb][detail].flatMap((row, y) => {
        const runs: React.ReactNode[] = [];
        for (let x = 0; x < row.length;) {
            if (row[x] === '.') { x++; continue; }
            const fill = spritePixelColour(paint, kind, bulb, row[x]);
            let end = x + 1;
            while (end < row.length && row[end] !== '.' && spritePixelColour(paint, kind, bulb, row[end]) === fill) end++;
            runs.push(<Rect key={`${y}-${x}`} x={inset + x * cell} y={inset + y * cell} width={(end - x) * cell} height={cell} fill={fill} />);
            x = end;
        }
        return runs;
    }) : null;
    const ascii = faceStyle === 'B' ? spriteAscii(kind, bulb, detail) : null;
    const columns = ascii ? Math.max(...ascii.lines.map(line => line.length), ascii.lines[ascii.face].length + 1) : 1;
    const fontSize = ascii ? Math.min(size * 0.94 / (0.6 * columns), size * 0.94 / (ascii.lines.length * 1.12)) : 0;
    const cw = 0.6 * fontSize, lh = 1.12 * fontSize;
    const x0 = (size - columns * cw) / 2, y0 = (size - (ascii?.lines.length ?? 0) * lh) / 2;
    const signal = spriteSignalColour(paint, bulb);
    const sx = size - 6;
    return (
        <View testID={testID} accessible={false} pointerEvents="none" style={{ width: size, height: size, flexShrink: 0 }}>
            <Animated.View testID="ip-sprite-art" style={{ width: size, height: size, transform: [{ translateY }] }}>
                <Svg testID={ascii ? 'ip-sprite-ascii' : 'ip-sprite-pixels'} width={size} height={size} viewBox={`0 0 ${size} ${size}`} accessible={false}>
                    {pixels}
                    {ascii?.lines.map((line, i) => <SvgText key={i} x={x0} y={y0 + lh * i + fontSize * 0.82} fontSize={fontSize} fontFamily={DESK_FONT_STACK} fontWeight="700" fontVariantLigatures="none" fill={spriteAsciiColour(paint, kind)}>{line.replace(/ /g, '\u00a0')}</SvgText>)}
                    {ascii ? <Rect testID="ip-sprite-cursor" x={x0 + (ascii.lines[ascii.face].length + 0.12) * cw} y={y0 + lh * ascii.face + fontSize * 0.02} width={cw * 0.82} height={fontSize * 0.98} fill={signal} /> : null}
                </Svg>
            </Animated.View>
            {/* Fixed geometry and page-contrast colour: state never depends on the animal or paint. */}
            <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} accessible={false} style={{ position: 'absolute', top: 0, left: 0 }}>
                <Rect testID="ip-sprite-signal" x={sx} y={1} width={5} height={5} fill={signal} />
                {bulb === 'stuck' ? <>
                    <Rect x={sx + 1} y={2} width={3} height={3} fill={paint.panel2} />
                    <Path testID="ip-sprite-stuck-x" d={`M${sx + 1} 2l3 3m0-3l-3 3`} stroke={signal} strokeWidth={1} />
                </> : null}
            </Svg>
        </View>
    );
});
