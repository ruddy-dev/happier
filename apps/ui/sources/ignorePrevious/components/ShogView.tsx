import * as React from 'react';
import { Pressable, View } from 'react-native';
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import Svg, { Circle, Ellipse, G, Path } from 'react-native-svg';
import { useUnistyles } from 'react-native-unistyles';

import { useReducedMotionPreference } from '@/hooks/ui/useReducedMotionPreference';
import { type CustomModalInjectedProps } from '@/modal';
import { useModalCardChrome } from '@/modal/components/card/useModalCardChrome';
import { Text } from '@/components/ui/text/Text';
import { t } from '@/text';

import { useIpColours } from '../palette';
import { MaskFace } from './MaskFace';
import { useWaitingCount } from '../model/useDeskWaits';

/** How long the creature moves after it opens or after Replay, then it holds still (no looping motion). */
export const SHOG_PLAY_MS = 6000;
const BREATH_MS = SHOG_PLAY_MS / 6;
const EYE_COUNT = 8;

// Eye positions on the body, behind and around the mask (viewBox 0 0 200 170).
const EYES: ReadonlyArray<readonly [number, number, number]> = [
    [38, 52, 7], [162, 50, 7], [24, 92, 6], [176, 94, 6],
    [58, 26, 5], [142, 24, 5], [44, 128, 5], [156, 130, 5],
];

type Playback = 'playing' | 'paused' | 'still';

/**
 * Shog up close: the coordinator as a shoggoth wearing the Ignore Previous mask. Each red eye is
 * one thing waiting on you (up to eight). It breathes for six seconds when opened, then holds
 * still; Pause and Replay control that, and reduced motion keeps it still.
 * Placeholder art: the site's creature replaces it once that code is licensed for this fork.
 */
export function ShogView({ onClose, setChrome }: CustomModalInjectedProps) {
    const { theme } = useUnistyles();
    const colours = useIpColours();
    const reducedMotion = useReducedMotionPreference();
    const waiting = useWaitingCount();
    const redEyes = Math.min(waiting, EYE_COUNT);
    const [playback, setPlayback] = React.useState<Playback>(reducedMotion ? 'still' : 'playing');
    const breath = useSharedValue(0);

    React.useEffect(() => {
        if (reducedMotion) setPlayback('still');
    }, [reducedMotion]);

    React.useEffect(() => {
        if (playback === 'playing') {
            breath.value = 0;
            breath.value = withRepeat(withTiming(1, { duration: BREATH_MS, easing: Easing.inOut(Easing.sin) }), 6, true);
            const timer = setTimeout(() => setPlayback('still'), SHOG_PLAY_MS);
            return () => clearTimeout(timer);
        }
        cancelAnimation(breath);
        // Settle back to rest rather than snapping; Pause holds the pose where it is.
        if (playback === 'still') breath.value = reducedMotion ? 0 : withTiming(0, { duration: 200 });
        return undefined;
    }, [playback, breath, reducedMotion]);

    React.useEffect(() => () => cancelAnimation(breath), [breath]);

    const bodyStyle = useAnimatedStyle(() => ({
        transform: [{ translateY: -4 * breath.value }, { scale: 1 + 0.03 * breath.value }],
    }));

    const chrome = React.useMemo(() => ({
        kind: 'card' as const,
        title: t('ignorePrevious.shogTitle'),
        testID: 'ip-shog',
        closeButtonTestID: 'ip-shog-close',
        dimensions: { width: 420, maxHeightRatio: 0.85, size: 'dialog' as const },
    }), []);
    useModalCardChrome(setChrome, chrome);

    const summary = redEyes === 0 ? t('ignorePrevious.shogCalm') : t('ignorePrevious.shogWaiting', { count: waiting });

    return (
        <View style={{ alignItems: 'center', gap: 16, paddingVertical: 12 }}>
            <View accessible accessibilityRole="image" accessibilityLabel={summary} style={{ width: 240, height: 204 }}>
                <Animated.View style={[{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }, bodyStyle]}>
                    <Svg width={240} height={204} viewBox="0 0 200 170">
                        <G fill={colours.flesh} stroke={colours.fleshEdge} strokeWidth={3} strokeLinejoin="round">
                            <Path d="M100 8C150 8 192 44 192 96c0 40-20 62-40 66-10 2-14-12-24-12s-14 14-28 14-18-14-28-14-14 14-24 12C28 158 8 136 8 96 8 44 50 8 100 8z" />
                            <Path d="M30 150c-6 8-14 10-20 8M170 150c6 8 14 10 20 8" fill="none" />
                        </G>
                        <G>
                            {EYES.map(([cx, cy, r], index) => {
                                const red = index < redEyes;
                                return (
                                    <G key={index} testID={red ? `ip-shog-eye-red-${index}` : `ip-shog-eye-${index}`}>
                                        <Ellipse cx={cx} cy={cy} rx={r} ry={r * 0.8} fill={red ? colours.red : colours.paleEye} />
                                        <Circle cx={cx} cy={cy} r={r * 0.35} fill={colours.ink} />
                                    </G>
                                );
                            })}
                        </G>
                    </Svg>
                </Animated.View>
                <View style={{ position: 'absolute', left: 70, top: 46 }}>
                    <MaskFace size={100} bulb={redEyes > 0 ? 'turn' : 'rest'} sleepy={false} />
                </View>
            </View>
            {/* The image above already announces the summary. */}
            <Text
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                aria-hidden
                style={{ color: theme.colors.text.primary, fontSize: 15, textAlign: 'center' }}
            >
                {summary}
            </Text>
            <View style={{ flexDirection: 'row', gap: 12 }}>
                {reducedMotion ? null : playback === 'playing' ? (
                    <ShogButton testID="ip-shog-pause" label={t('ignorePrevious.shogPause')} onPress={() => setPlayback('paused')} />
                ) : (
                    <ShogButton testID="ip-shog-replay" label={t('ignorePrevious.shogReplay')} onPress={() => setPlayback('playing')} />
                )}
                <ShogButton testID="ip-shog-done" label={t('common.close')} onPress={onClose} />
            </View>
        </View>
    );
}

function ShogButton({ testID, label, onPress }: { testID: string; label: string; onPress: () => void }) {
    const { theme } = useUnistyles();
    return (
        <Pressable
            testID={testID}
            accessibilityRole="button"
            onPress={onPress}
            style={({ pressed }) => ({
                paddingHorizontal: 16,
                paddingVertical: 8,
                borderRadius: 999,
                borderWidth: 1,
                borderColor: theme.colors.border.strong,
                backgroundColor: pressed ? theme.colors.surface.pressed : 'transparent',
            })}
        >
            <Text style={{ color: theme.colors.text.primary, fontSize: 14 }}>{label}</Text>
        </Pressable>
    );
}
