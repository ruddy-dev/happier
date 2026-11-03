import * as React from 'react';
import { Platform, Pressable, View } from 'react-native';

import { useReducedMotionPreference } from '@/hooks/ui/useReducedMotionPreference';
import { t } from '@/text';

import { DeskCreature } from '../creature/DeskCreature';
import { useDeskPref } from '../deskPrefs';
import { useDeskWaitsSummary, useWaitingCount } from '../model/useDeskWaits';
import { terminalPalettes, useDeskPaint, type SpriteTheme } from '../palette';
import { DeskText } from '../typography/DeskText';
import { MaskFace } from './MaskFace';

/** The panel's explicit Pause/Replay controls allow the mockup's six-second run. */
export const SHOG_PLAY_MS = 6000;
const PANEL_ANCHOR = { x: 0.5, y: 0.5 } as const;
const PANEL_SCALE = 1.6;
type Playback = 'playing' | 'paused' | 'still';

/** Shog up close uses the same creature engine as the retained, paused header instance. */
export function ShogView({ onClose, contentRef, panelId, height = 360 }: {
    onClose: () => void;
    contentRef?: React.RefObject<View | null>;
    panelId?: string;
    height?: number;
}) {
    const desk = useDeskPaint();
    const [style] = useDeskPref('chatStyle');
    const [terminalPalette] = useDeskPref('terminalPalette');
    const terminal = style === 'terminal';
    const paint = terminal ? terminalPalettes[terminalPalette] : desk.paint;
    const artTheme = terminal ? (terminalPalette === 'terminalPaper' ? 'light' : 'dark') : undefined;
    const maskColours = terminal ? { ...desk.colours, bone: paint.maskrim, red: paint.brandred,
        yellow: paint.yel, work: paint.work, off: paint.off, idleSignal: paint.idleSignal, turnSignal: paint.turnSignal } : undefined;
    const [creatureEnabled] = useDeskPref('creatureEnabled');
    const reducedMotion = useReducedMotionPreference();
    const calm = reducedMotion || !creatureEnabled;
    const waiting = useWaitingCount();
    const { ready } = useDeskWaitsSummary();
    const redEyes = ready ? Math.min(waiting, 8) : 0;
    const [playback, setPlayback] = React.useState<Playback>(calm ? 'still' : 'playing');
    const [width, setWidth] = React.useState(0);
    const stageHeight = Math.max(100, height - 110);
    // Mockup 12 uses maskScale .55 and draws the foreground mask 1.25 times the engine's .8 head width.
    const maskSize = Math.min(stageHeight * 0.25, width * 0.2) * PANEL_SCALE * 0.55;

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
            id={Platform.OS === 'web' ? panelId : undefined}
            style={{ backgroundColor: paint.bg }}>
            <View onLayout={event => setWidth(event.nativeEvent.layout.width)} style={{ height: stageHeight, position: 'relative' }}>
                <DeskCreature style="slips" redEyes={redEyes} mode="working" height={stageHeight}
                    anchor={PANEL_ANCHOR} scale={PANEL_SCALE} artTheme={artTheme} maskColours={maskColours} playback={!calm && playback === 'playing' ? 'playing' : 'paused'} />
                {maskSize > 0 && Platform.OS !== 'ios' && Platform.OS !== 'android' ? <View pointerEvents="none" accessible={false}
                    style={{ position: 'absolute', left: (width - maskSize) / 2, top: (stageHeight - maskSize * 1.08) / 2, transform: [{ rotate: '-6deg' }] }}>
                    <MaskFace size={maskSize} shadow colours={maskColours} bulb={redEyes > 0 ? 'turn' : 'rest'} />
                </View> : null}
            </View>
            <View testID="ip-shog-footer" style={{ paddingHorizontal: 16, paddingVertical: 10, gap: 10, borderTopWidth: 1,
                borderTopColor: paint.rule, backgroundColor: paint.panel, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }}>
                <DeskText testID="ip-shog-status" accessibilityLiveRegion="polite"
                    style={{ color: paint.mute, fontSize: 13, flexGrow: 1, flexShrink: 1, minWidth: 180 }}>{summary}</DeskText>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                    {calm ? null : playback === 'playing' ? (
                        <ShogButton terminal={terminal} paint={paint} testID="ip-shog-pause" label={t('ignorePrevious.shogPause')} onPress={() => setPlayback('paused')} />
                    ) : (
                        <ShogButton terminal={terminal} paint={paint} testID="ip-shog-replay" label={t('ignorePrevious.shogReplay')} onPress={() => setPlayback('playing')} />
                    )}
                    <ShogButton terminal={terminal} paint={paint} testID="ip-shog-done" label={t('common.close')} onPress={onClose} />
                </View>
            </View>
        </View>
    );
}

function ShogButton({ testID, label, onPress, terminal, paint }: {
    testID: string; label: string; onPress: () => void; terminal: boolean; paint: SpriteTheme;
}) {
    return <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label} onPress={onPress}
        style={({ pressed }) => ({ paddingHorizontal: terminal ? 4 : 16, paddingVertical: 10, minHeight: 44,
            borderRadius: terminal ? 2 : 12, borderWidth: terminal ? 0 : 1,
            borderColor: paint.rule, backgroundColor: pressed ? paint.rule : paint.panel })}>
        <DeskText style={{ color: paint.ink, fontSize: terminal ? 13 : 14 }}>{terminal ? `[ ${label} ]` : label}</DeskText>
    </Pressable>;
}
