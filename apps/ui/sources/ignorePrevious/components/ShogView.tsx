import * as React from 'react';
import { Pressable, View } from 'react-native';

import { useReducedMotionPreference } from '@/hooks/ui/useReducedMotionPreference';
import { t } from '@/text';

import { DeskCreature } from '../creature/DeskCreature';
import { useDeskPref } from '../deskPrefs';
import { useDeskWaitsSummary, useWaitingCount } from '../model/useDeskWaits';
import { useDeskPaint } from '../palette';
import { DeskText } from '../typography/DeskText';
import { MaskFace } from './MaskFace';

/** The panel's explicit Pause/Replay controls allow the mockup's six-second run. */
export const SHOG_PLAY_MS = 6000;
const PANEL_ANCHOR = { x: 0.5, y: 0.5 } as const;
const PANEL_SCALE = 1.6;
type Playback = 'playing' | 'paused' | 'still';

/** Shog up close uses the same creature engine as the retained, paused header instance. */
export function ShogView({ onClose, contentRef, height = 360 }: {
    onClose: () => void;
    contentRef?: React.RefObject<View | null>;
    height?: number;
}) {
    const { paint } = useDeskPaint();
    const [creatureEnabled] = useDeskPref('creatureEnabled');
    const reducedMotion = useReducedMotionPreference();
    const calm = reducedMotion || !creatureEnabled;
    const waiting = useWaitingCount();
    const { ready } = useDeskWaitsSummary();
    const redEyes = ready ? Math.min(waiting, 8) : 0;
    const [playback, setPlayback] = React.useState<Playback>(calm ? 'still' : 'playing');
    const [width, setWidth] = React.useState(0);
    const stageHeight = Math.max(100, height - 110);
    // The engine's maskBox uses headW * 0.8; mockup 12 draws the foreground mask 1.25 times that.
    const maskSize = Math.min(stageHeight * 0.25, width * 0.2) * PANEL_SCALE;

    React.useEffect(() => {
        if (calm) setPlayback('still');
    }, [calm]);
    React.useEffect(() => {
        if (playback !== 'playing' || calm) return;
        const timer = setTimeout(() => setPlayback('still'), SHOG_PLAY_MS);
        return () => clearTimeout(timer);
    }, [playback, calm]);

    const summary = !ready ? t('ignorePrevious.connecting')
        : redEyes === 0 ? t('ignorePrevious.shogCalm') : t('ignorePrevious.shogWaiting', { count: waiting });
    return (
        <View ref={contentRef} testID="ip-shog" role="region" accessibilityLabel={t('ignorePrevious.shogTitle')}
            style={{ backgroundColor: paint.panel }}>
            <View onLayout={event => setWidth(event.nativeEvent.layout.width)} style={{ height: stageHeight, position: 'relative' }}>
                <DeskCreature style="slips" redEyes={redEyes} mode="working" height={stageHeight}
                    anchor={PANEL_ANCHOR} scale={PANEL_SCALE} playback={!calm && playback === 'playing' ? 'playing' : 'paused'} />
                {maskSize > 0 ? <View pointerEvents="none" accessible={false}
                    style={{ position: 'absolute', left: (width - maskSize) / 2, top: (stageHeight - maskSize * 1.08) / 2 }}>
                    <MaskFace size={maskSize} bulb={redEyes > 0 ? 'turn' : 'rest'} sleepy={false} />
                </View> : null}
            </View>
            <View style={{ padding: 12, gap: 10, borderTopWidth: 1, borderTopColor: paint.rule }}>
                <DeskText accessibilityLiveRegion="polite" style={{ color: paint.ink, fontSize: 13 }}>{summary}</DeskText>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                    {calm ? null : playback === 'playing' ? (
                        <ShogButton testID="ip-shog-pause" label={t('ignorePrevious.shogPause')} onPress={() => setPlayback('paused')} />
                    ) : (
                        <ShogButton testID="ip-shog-replay" label={t('ignorePrevious.shogReplay')} onPress={() => setPlayback('playing')} />
                    )}
                    <ShogButton testID="ip-shog-done" label={t('common.close')} onPress={onClose} />
                </View>
            </View>
        </View>
    );
}

function ShogButton({ testID, label, onPress }: { testID: string; label: string; onPress: () => void }) {
    const { paint } = useDeskPaint();
    return <Pressable testID={testID} accessibilityRole="button" onPress={onPress}
        style={({ pressed }) => ({ paddingHorizontal: 16, paddingVertical: 10, minHeight: 44, borderRadius: 12,
            borderWidth: 1, borderColor: paint.rule, backgroundColor: pressed ? paint.rule : paint.panel })}>
        <DeskText style={{ color: paint.ink, fontSize: 14 }}>{label}</DeskText>
    </Pressable>;
}
