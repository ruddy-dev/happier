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
    const nativeStill = Platform.OS === 'ios' || Platform.OS === 'android';
    const calm = reducedMotion || !creatureEnabled || nativeStill;
    const waiting = useWaitingCount();
    const { ready } = useDeskWaitsSummary();
    const redEyes = ready ? Math.min(waiting, 8) : 0;
    const [playback, setPlayback] = React.useState<Playback>(calm ? 'still' : 'playing');
    const [replay, setReplay] = React.useState(0);
    const [footerHeight, setFooterHeight] = React.useState(110);
    const [width, setWidth] = React.useState(0);
    const stageHeight = Math.max(100, height - footerHeight);
    // Mockup 12 uses maskScale .55 and draws the foreground mask 1.25 times the engine's .8 head width.
    const maskSize = Math.min(stageHeight * 0.25, width * 0.2) * PANEL_SCALE * 0.55;

    React.useEffect(() => {
        if (calm) setPlayback('still');
    }, [calm]);
    React.useEffect(() => {
        if (playback !== 'playing' || calm) return;
        const timer = setTimeout(() => setPlayback('still'), SHOG_PLAY_MS);
        return () => clearTimeout(timer);
    }, [playback, calm, replay]);

    const summary = !ready ? t('ignorePrevious.connecting')
        : nativeStill ? (waiting === 0 ? t('ignorePrevious.nothingWaits') : t('ignorePrevious.coordinatorHeader.waiting', { count: waiting }))
        : redEyes === 0 ? t('ignorePrevious.shogCalm') : t('ignorePrevious.shogWaiting', { count: waiting });
    const motion = nativeStill ? t('ignorePrevious.shogPanel.nativeStill')
        : reducedMotion ? t('ignorePrevious.shogPanel.calm')
        : !creatureEnabled ? t('ignorePrevious.shogPanel.motionOff')
        : playback === 'playing' ? t('ignorePrevious.shogPanel.playing')
        : playback === 'paused' ? t('ignorePrevious.shogPanel.paused') : t('ignorePrevious.shogPanel.still');
    const restart = () => {
        if (calm) return;
        // Only explicit Replay replaces this surface's renderer. Pause keeps its current frame.
        setReplay(value => value + 1);
        setPlayback('playing');
    };
    return (
        <View ref={contentRef} testID="ip-shog" role="region" accessibilityLabel={t('ignorePrevious.shogTitle')}
            id={Platform.OS === 'web' ? panelId : undefined}
            style={{ backgroundColor: paint.bg }}>
            <View onLayout={event => setWidth(event.nativeEvent.layout.width)} style={{ height: stageHeight, position: 'relative' }}>
                <DeskCreature key={replay} style="slips" redEyes={redEyes} mode="working" height={stageHeight}
                    anchor={PANEL_ANCHOR} scale={PANEL_SCALE} artTheme={artTheme} maskColours={maskColours} playback={!calm && playback === 'playing' ? 'playing' : 'paused'} />
                {maskSize > 0 && Platform.OS !== 'ios' && Platform.OS !== 'android' ? <View pointerEvents="none" accessible={false}
                    style={{ position: 'absolute', left: (width - maskSize) / 2, top: (stageHeight - maskSize * 1.08) / 2, transform: [{ rotate: '-6deg' }] }}>
                    <MaskFace size={maskSize} shadow colours={maskColours} bulb={redEyes > 0 ? 'turn' : 'rest'} />
                </View> : null}
            </View>
            <View testID="ip-shog-footer" onLayout={event => setFooterHeight(event.nativeEvent.layout.height)}
                style={{ paddingHorizontal: 16, paddingVertical: 10, gap: 10, borderTopWidth: 1,
                    borderTopColor: paint.rule, backgroundColor: paint.panel, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }}>
                <View style={{ flexBasis: 180, flexGrow: 1, flexShrink: 1, minWidth: 0, gap: 4 }}>
                    <DeskText testID="ip-shog-caption" style={{ color: paint.mute, fontSize: 13 }}>
                        {nativeStill ? t('ignorePrevious.shogPanel.nativeCaption') : t('ignorePrevious.shogPanel.caption')}
                    </DeskText>
                    <DeskText testID="ip-shog-status" accessibilityLiveRegion="polite" style={{ color: paint.mute, fontSize: 13 }}>
                        {summary}{' '}<DeskText testID="ip-shog-playback" style={{ color: paint.ink, fontSize: 13, fontWeight: '600' }}>{motion}</DeskText>
                    </DeskText>
                </View>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, maxWidth: '100%' }}>
                    <ShogButton terminal={terminal} paint={paint} testID="ip-shog-pause" label={t('ignorePrevious.shogPause')}
                        disabled={calm || playback !== 'playing'} onPress={() => setPlayback('paused')} />
                    <ShogButton terminal={terminal} paint={paint} testID="ip-shog-replay" label={t('ignorePrevious.shogReplay')}
                        disabled={calm} onPress={restart} />
                    <ShogButton terminal={terminal} paint={paint} testID="ip-shog-done" label={t('common.close')} onPress={onClose} />
                </View>
            </View>
        </View>
    );
}

function ShogButton({ testID, label, onPress, terminal, paint, disabled = false }: {
    testID: string; label: string; onPress: () => void; terminal: boolean; paint: SpriteTheme; disabled?: boolean;
}) {
    const [focused, setFocused] = React.useState(false);
    return <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label}
        accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
        onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
        style={({ pressed }) => ({ paddingHorizontal: terminal ? 8 : 12, paddingVertical: 10,
            minHeight: Platform.OS === 'android' ? 48 : 44, minWidth: 44, flexShrink: 1,
            borderRadius: terminal ? 2 : 12, borderWidth: 1,
            borderColor: focused ? paint.ink : terminal && !disabled ? paint.mute : paint.rule,
            backgroundColor: (focused || pressed) && !disabled ? paint.rule : paint.panel })}>
        <DeskText style={{ color: disabled ? paint.mute : paint.ink, fontSize: terminal ? 13 : 14 }}>{terminal ? `[ ${label} ]` : label}</DeskText>
    </Pressable>;
}
