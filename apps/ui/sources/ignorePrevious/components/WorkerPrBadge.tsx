import * as React from 'react';
import { Platform, Pressable, View } from 'react-native';

import { useSessionProjectScmSnapshot } from '@/sync/store/hooks';
import { t } from '@/text';
import { openExternalUrl } from '@/utils/url/openExternalUrl';

import { buildWorkerPrBadge } from '../model/workerPrBadge';
import { useDeskNow } from '../model/useDeskNow';
import { useDeskPaint } from '../palette';
import { DeskText } from '../typography/DeskText';

/** Store subscription only: mounting a worker badge must never request SCM refresh. */
export function WorkerPrBadge({ sessionId }: { sessionId: string }) {
    const snapshot = useSessionProjectScmSnapshot(sessionId);
    const now = useDeskNow();
    const { paint } = useDeskPaint();
    const badge = buildWorkerPrBadge(snapshot, now);
    if (!badge) return null;

    const state = t(`ignorePrevious.pullRequest.${badge.state}`);
    const label = t('ignorePrevious.pullRequest.badge', { number: badge.numberLabel, state });
    const asOf = badge.old && badge.fetchedAt !== null
        ? t('ignorePrevious.pullRequest.asOf', {
            time: new Date(badge.fetchedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }),
        }) : null;
    const signal = badge.old ? paint.mute : badge.state === 'open' ? paint.ok : badge.state === 'merged' ? paint.hl : paint.bad;

    return (
        <Pressable
            testID={`ip-worker-pr-${sessionId}`}
            accessibilityRole="link"
            accessibilityLabel={asOf ? `${label}. ${asOf}` : label}
            onPress={() => { void openExternalUrl(badge.url); }}
            style={{ justifyContent: 'center', minHeight: Platform.select({ ios: 44, android: 48, default: 28 }) }}
        >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, flexShrink: 0, borderWidth: 1, borderColor: paint.mute, borderRadius: 999, paddingHorizontal: 9, minHeight: 28 }}>
                <View accessible={false} style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: signal }} />
                <DeskText style={{ color: badge.old ? paint.mute : paint.ink, fontSize: 13, fontWeight: '600' }}>{label}</DeskText>
            </View>
        </Pressable>
    );
}
