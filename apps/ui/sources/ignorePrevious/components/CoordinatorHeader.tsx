import * as React from 'react';
import { Platform, Pressable, View } from 'react-native';

import type { Session } from '@/sync/domains/state/storageTypes';
import { t } from '@/text';
import { getSessionStatus } from '@/utils/sessions/sessionUtils';

import { DeskCreature } from '../creature/DeskCreature';
import { useCreatureMode } from '../creature/useCreatureMode';
import { useDeskPref } from '../deskPrefs';
import { coordinatorStateLine } from '../model/coordinatorStateLine';
import { useDeskNow } from '../model/useDeskNow';
import { useDeskWaitsActivity } from '../model/useDeskWaits';
import { useDeskPaint } from '../palette';
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
    accessory?: React.ReactNode;
}) {
    const [style] = useDeskPref('chatStyle');
    const [creatureEnabled] = useDeskPref('creatureEnabled');
    const desk = useDeskPaint();
    const terminal = style === 'terminal';
    const paint = desk.paint;
    const height = terminal ? 116 : 128;
    const [width, setWidth] = React.useState(0);
    const narrow = width > 0 && width < 860;
    const maskSize = terminal ? 40 : 46;
    const padding = terminal ? 12 : 16;
    const maskLeft = narrow ? 10 : 22;
    const now = useDeskNow();
    const status = session ? getSessionStatus(session, now, { workingTextMode: 'static' }) : null;
    const waits = useDeskWaitsActivity();
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
    const scale = width > 0 ? (maskSize * 1.3) / (0.8 * Math.min(height * 0.25, width * 0.2)) : undefined;
    const scrim = { backgroundColor: paint.panel, borderRadius: 18, boxShadow: `0 0 16px 12px ${paint.panel}` };

    return (
        <View testID="ip-coord-header" onLayout={event => setWidth(event.nativeEvent.layout.width)}
            style={{ height, flexShrink: 0, position: 'relative', overflow: 'hidden', backgroundColor: paint.panel,
                borderBottomWidth: desk.borderWidth, borderBottomColor: paint.rule,
                flexDirection: 'row', alignItems: 'center', gap: terminal ? 10 : 14, paddingHorizontal: padding }}>
            {creatureEnabled ? <Pressable ref={shogCreatureOpenerRef} accessible={false} focusable={false}
                {...(Platform.OS === 'web' ? { tabIndex: -1 as const } : {})} onPress={onOpenShog}
                style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }}>
                <DeskCreature style={terminal ? 'terminal' : 'slips'} redEyes={waits.count ?? 0} mode={mode}
                    playback={shogOpen ? 'paused' : undefined} height={height} anchor={anchor} scale={scale} />
            </Pressable> : null}
            <Pressable ref={shogOpenerRef} testID="ip-shog-open" aria-expanded={shogOpen} accessibilityState={{ expanded: shogOpen }} accessibilityRole="button" accessibilityLabel={t(shogOpen ? 'ignorePrevious.shogPanel.close' : 'ignorePrevious.openShog')}
                aria-controls={Platform.OS === 'web' ? shogPanelId : undefined}
                onPress={onOpenShog} hitSlop={6} style={{ marginLeft: maskLeft, marginRight: narrow ? 18 : 34, flexShrink: 0 }}>
                <MaskFace testID="ip-coord-mask" size={maskSize}
                    bulb={waits.count === null ? 'idle' : waits.count > 0 ? 'turn' : 'rest'} sleepy={false} />
            </Pressable>
            <View style={[scrim, { minWidth: 0, flexShrink: 1, gap: 4, paddingHorizontal: 6, paddingVertical: 2 }]}>
                <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 9, flexWrap: 'wrap' }}>
                    <DeskText style={{ color: paint.ink, fontSize: 30,
                        fontWeight: '700', letterSpacing: -0.9 }}>{t('ignorePrevious.coordinatorNickname')}</DeskText>
                    <DeskText style={{ color: paint.mute, fontSize: 12, fontWeight: '500', letterSpacing: 0.24 }}>
                        {t('ignorePrevious.coordinatorHeader.role')}
                    </DeskText>
                </View>
                {state ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                    <View accessible={false} style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: signal }} />
                    <DeskText testID="ip-coord-state" accessibilityLiveRegion="polite" numberOfLines={1}
                        style={{ color: paint.ink, fontSize: 13.5, flexShrink: 1 }}>{stateText}</DeskText>
                </View> : null}
            </View>
            {accessory ? <View style={[scrim, { marginLeft: 'auto', padding: 4, flexShrink: 0 }]}>{accessory}</View> : null}
        </View>
    );
}
