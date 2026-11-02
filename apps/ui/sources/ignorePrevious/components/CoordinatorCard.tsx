import * as React from 'react';
import { Platform, Pressable, View } from 'react-native';

import { useSession } from '@/sync/store/hooks';
import { t } from '@/text';
import { getSessionStatus } from '@/utils/sessions/sessionUtils';

import { coordinatorStateLine } from '../model/coordinatorStateLine';
import { useDeskNow } from '../model/useDeskNow';
import { useDeskWaitsSummary } from '../model/useDeskWaits';
import { useDeskPaint } from '../palette';
import { DeskText } from '../typography/DeskText';
import { sessionContextMeter } from './ContextMeter';
import { MaskFace } from './MaskFace';

/** A separate coordinator shortcut, outside Work's worker rows and counts. */
export function CoordinatorCard({ sessionId, form, onOpen }: {
    sessionId: string;
    form: 'full' | 'slim' | 'rail';
    onOpen: () => void;
}) {
    const session = useSession(sessionId);
    const now = useDeskNow();
    const waits = useDeskWaitsSummary();
    const waitingCount = waits.ready ? waits.count : null;
    const status = session ? getSessionStatus(session, now, { workingTextMode: 'static' }) : null;
    // Item 1.8 owns state precedence, including unknown waits. The card only presents it.
    const state = coordinatorStateLine(status, waitingCount);
    const stateText = !state ? null : state.kind === 'waiting'
        ? t('ignorePrevious.coordinatorHeader.waiting', { count: state.count })
        : t(`ignorePrevious.coordinatorHeader.${state.kind}`);
    const waitingText = waitingCount === null ? null : t('ignorePrevious.coordinatorCard.waiting', { count: waitingCount });
    // The composer gauge and this card use the same session report and compact/window model.
    const meter = form === 'full' && session ? sessionContextMeter(session) : null;
    const percent = meter ? t('ignorePrevious.contextGauge.percent', { percent: meter.percent }) : null;
    const contextLabel = percent ? t('ignorePrevious.coordinatorCard.context', { percent }) : null;
    const { paint, borderWidth } = useDeskPaint();
    const signal = state?.kind === 'waiting' ? paint.turnSignal : state?.kind === 'thinking' ? paint.work
        : state?.kind === 'offline' ? paint.off : paint.idleSignal;
    const rail = form === 'rail';
    const full = form === 'full';

    return (
        <Pressable testID={`ip-coord-card-${form}`} accessibilityRole="button"
            accessibilityLabel={[t('ignorePrevious.coordinatorCard.openChat'), stateText, waitingText, contextLabel].filter(Boolean).join('. ')}
            onPress={onOpen}
            style={{ flexDirection: rail ? 'column' : 'row', alignItems: 'center', gap: full ? 10 : 8,
                minWidth: 0, maxWidth: '100%', width: rail ? 62 : '100%',
                minHeight: Platform.OS === 'web' ? 36 : 48, paddingVertical: full ? 8 : 5, paddingHorizontal: rail ? 2 : 10,
                borderWidth: rail ? 0 : borderWidth, borderColor: paint.edge, borderRadius: rail ? 10 : 12,
                backgroundColor: paint.bg }}>
            <MaskFace size={full ? 38 : rail ? 28 : 22}
                bulb={waitingCount === null ? 'idle' : waitingCount > 0 ? 'turn' : 'rest'} sleepy={false} />
            <View style={{ flex: rail ? undefined : 1, minWidth: 0, gap: full ? 4 : 0 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: rail ? 'center' : 'flex-start', gap: 8, minWidth: 0 }}>
                    <DeskText style={{ color: paint.ink, fontSize: full ? 15 : 13.5, fontWeight: '600' }}>
                        {t('ignorePrevious.coordinatorNickname')}
                    </DeskText>
                    {state ? <View accessible={false} style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: signal }} /> : null}
                    {full && stateText ? <DeskText testID="ip-coord-card-state" numberOfLines={1}
                        style={{ color: paint.ink, fontSize: 12.5, flexShrink: 1 }}>{stateText}</DeskText> : null}
                    {!full && !rail && waitingText ? <DeskText testID="ip-coord-card-waiting" numberOfLines={1}
                        style={{ color: paint.mute, fontSize: 12.5, flexShrink: 1 }}>{waitingText}</DeskText> : null}
                </View>
                {full ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
                    {waitingText ? <DeskText testID="ip-coord-card-waiting" style={{ color: paint.mute, fontSize: 12.5 }}>{waitingText}</DeskText> : null}
                    {meter ? <View testID="ip-coord-card-context-meter" accessibilityRole="progressbar"
                        accessibilityLabel={contextLabel!} accessibilityValue={{ min: 0, max: 100, now: meter.ratio * 100, text: percent! }}
                        style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginLeft: 'auto' }}>
                        <View accessible={false} style={{ width: 44, height: 5, borderRadius: 3, backgroundColor: paint.rule, overflow: 'hidden' }}>
                            <View style={{ height: '100%', width: `${meter.ratio * 100}%`, backgroundColor: paint.turnSignal }} />
                        </View>
                        <DeskText testID="ip-coord-card-context" style={{ color: paint.ink, fontSize: 12 }}>{percent}</DeskText>
                    </View> : null}
                </View> : null}
                {rail && waitingCount !== null ? <DeskText testID="ip-coord-card-waiting"
                    style={{ color: paint.ink, fontSize: 12, textAlign: 'center' }}>{waitingCount}</DeskText> : null}
            </View>
        </Pressable>
    );
}
