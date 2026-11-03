import * as React from 'react';
import { Platform, Pressable, View, useWindowDimensions } from 'react-native';

import { isDeskPhoneWidth } from '../model/drawerPlacement';

import type { Session } from '@/sync/domains/state/storageTypes';
import { t } from '@/text';
import { getSessionStatus } from '@/utils/sessions/sessionUtils';

import { DeskCreature } from '../creature/DeskCreature';
import { useCreatureMode } from '../creature/useCreatureMode';
import { useDeskPref } from '../deskPrefs';
import { coordinatorStateLine } from '../model/coordinatorStateLine';
import { useDeskNow } from '../model/useDeskNow';
import { useDeskWaitsActivity } from '../model/useDeskWaits';
import { terminalPalettes, useDeskPaint } from '../palette';
import { DeskText } from '../typography/DeskText';
import { MaskFace } from './MaskFace';

/** Mockup 12 round 8: a large name, quiet role, and readable state over the creature. */
export function CoordinatorHeader({ session, onOpenShog, shogOpen = false, shogOpenerRef, shogCreatureOpenerRef, shogPanelId, accessory }: {
    session: Session | null;
    onOpenShog: () => void;
    shogOpen?: boolean;
    shogOpenerRef?: React.RefObject<View | null>;
    shogCreatureOpenerRef?: React.RefObject<View | null>;
    shogPanelId?: string;
    accessory?: (colour: string) => React.ReactNode;
}) {
    const [style] = useDeskPref('chatStyle');
    const [creatureEnabled] = useDeskPref('creatureEnabled');
    const [terminalPalette] = useDeskPref('terminalPalette');
    const { width: windowWidth } = useWindowDimensions();
    const phone = isDeskPhoneWidth(windowWidth);
    const desk = useDeskPaint();
    const terminal = style === 'terminal';
    const paint = terminal ? terminalPalettes[terminalPalette] : desk.paint;
    const artTheme = terminal ? (terminalPalette === 'terminalPaper' ? 'light' : 'dark') : undefined;
    const maskColours = terminal ? { ...desk.colours, bone: paint.maskrim, red: paint.brandred,
        yellow: paint.yel, work: paint.work, off: paint.off, idleSignal: paint.idleSignal, turnSignal: paint.turnSignal } : undefined;
    const height = phone ? 72 : terminal ? 116 : 128;
    const [width, setWidth] = React.useState(0);
    const narrow = width > 0 && width < 860;
    const maskSize = phone ? 34 : terminal ? 40 : 46;
    const padding = phone ? 10 : terminal ? 12 : 16;
    const maskLeft = phone ? 4 : narrow ? 10 : 22;
    const now = useDeskNow();
    const status = session ? getSessionStatus(session, now, { workingTextMode: 'static' }) : null;
    const waits = useDeskWaitsActivity({ onlySessionId: session?.id ?? '' });
    const state = coordinatorStateLine(status, waits.count);
    const mode = useCreatureMode({
        coordinator: state?.kind === 'offline' ? 'offline' : status?.state === 'resuming' ? 'resuming'
            : state?.kind === 'thinking' ? 'replying' : 'idle',
        waitingCount: waits.count,
        requests: waits.requests,
        unloadedSessionIds: waits.unloadedSessionIds,
        calm: !creatureEnabled,
    });
    const stateText = !state ? null : state.kind === 'waiting'
        ? t('ignorePrevious.coordinatorHeader.waiting', { count: state.count })
        : t(`ignorePrevious.coordinatorHeader.${state.kind}`);
    const signal = state?.kind === 'waiting' ? paint.turnSignal
        : state?.kind === 'thinking' ? paint.work : state?.kind === 'offline' ? paint.off : paint.idleSignal;
    // Same mask-relative geometry as hGeom in mockup 12; width ratios drift at wide sizes.
    const anchor = width > 0 ? {
        x: (padding + maskLeft + maskSize / 2) / width,
        y: (height / 2 + maskSize * 1.08 * 0.1) / height,
    } : undefined;
    const scale = width > 0 ? (maskSize * 1.6) / (0.8 * Math.min(height * 0.25, width * 0.2)) : undefined;
    const scrim = { backgroundColor: paint.panel, borderRadius: terminal ? 4 : 18, boxShadow: `0 0 16px 12px ${paint.panel}` };

    return (
        <View testID="ip-coord-header" onLayout={event => setWidth(event.nativeEvent.layout.width)}
            style={{ height, flexShrink: 0, position: 'relative', overflow: 'hidden', backgroundColor: paint.panel,
                borderBottomWidth: desk.borderWidth, borderBottomColor: paint.rule,
                flexDirection: 'row', alignItems: 'center', gap: terminal ? 10 : 14, paddingHorizontal: padding }}>
            {creatureEnabled ? <Pressable ref={shogCreatureOpenerRef} accessible={false} focusable={false}
                {...(Platform.OS === 'web' ? { tabIndex: -1 as const } : {})} onPress={onOpenShog}
                style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, opacity: 0.75 }}>
                <DeskCreature style={terminal ? 'terminal' : 'slips'} redEyes={Math.min(waits.count ?? 0, 8)} mode={mode}
                    playback={shogOpen ? 'paused' : undefined} artTheme={artTheme} maskColours={maskColours} height={height} anchor={anchor} scale={scale} />
            </Pressable> : null}
            <Pressable ref={shogOpenerRef} testID="ip-shog-open" aria-expanded={shogOpen} accessibilityState={{ expanded: shogOpen }} accessibilityRole="button" accessibilityLabel={t(shogOpen ? 'ignorePrevious.shogPanel.close' : 'ignorePrevious.openShog')}
                aria-controls={Platform.OS === 'web' ? shogPanelId : undefined}
                onPress={onOpenShog} hitSlop={6} style={{ marginLeft: maskLeft, marginRight: phone ? 8 : narrow ? 18 : 34, flexShrink: 0 }}>
                <MaskFace testID="ip-coord-mask" size={maskSize}
                    colours={maskColours} bulb={waits.count === null ? 'idle' : waits.count > 0 ? 'turn' : 'rest'} />
            </Pressable>
            <View style={[scrim, { minWidth: 0, flexShrink: 1, gap: 4, paddingHorizontal: 6, paddingVertical: 2 }]}>
                <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 9, flexWrap: 'wrap' }}>
                    <DeskText style={{ color: terminal ? paint.bot : paint.ink, fontSize: terminal ? (phone ? 15 : 17) : (phone ? 22 : 30),
                        fontWeight: '700', letterSpacing: terminal ? 0 : -0.9 }}>
                        {terminal ? <DeskText style={{ color: paint.mute }}>~/</DeskText> : null}{t('ignorePrevious.coordinatorNickname')}
                    </DeskText>
                    <DeskText style={{ color: paint.mute, fontSize: 12, fontWeight: '500', letterSpacing: 0.24 }}>
                        {terminal ? '# ' : ''}{t('ignorePrevious.coordinatorHeader.role')}
                    </DeskText>
                </View>
                {state ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                    <View accessible={false} style={{ width: 9, height: 9, borderRadius: terminal ? 0 : 5, backgroundColor: signal }} />
                    <DeskText testID="ip-coord-state" accessibilityLiveRegion="polite" numberOfLines={1}
                        style={{ color: paint.ink, fontSize: 13.5, flexShrink: 1 }}>{stateText}</DeskText>
                </View> : null}
            </View>
            {accessory ? <View style={[scrim, { marginLeft: 'auto', padding: 4, flexShrink: 0 }]}>{accessory(paint.ink)}</View> : null}
        </View>
    );
}
