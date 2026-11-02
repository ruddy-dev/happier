import { useState } from 'react';
import { View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { Text } from '@/components/ui/text/Text';
import { useLastSyncAt, useSocketStatus } from '@/sync/store/hooks';
import { t } from '@/text';

/** Connection timestamps come from the sync store, not from worker freshness. */
export function DeskConnectionBanner() {
    const { status, lastDisconnectedAt } = useSocketStatus();
    const lastSyncAt = useLastSyncAt();
    const { theme } = useUnistyles();
    // The store restamps the disconnect time on every failed retry (connect_error), so keep the
    // first stamp seen in this outage and clear it on reconnect.
    const [droppedAt, setDroppedAt] = useState<number | null>(null);
    const current = status === 'connected' ? null : (droppedAt ?? lastDisconnectedAt ?? lastSyncAt);
    if (current !== droppedAt) setDroppedAt(current);
    if (status === 'connected') return null;
    const stamp = current === null ? null : new Date(current);
    const today = new Date();
    const isToday = stamp?.toDateString() === today.toDateString();
    const message = stamp !== null
        ? t('ignorePrevious.connection.lastSeen', {
            time: isToday
                ? stamp.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
                : stamp.toLocaleString(undefined, {
                    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                }),
        })
        : t('ignorePrevious.connection.noData');
    return (
        <View testID="ip-connection-status" role="status" accessibilityLiveRegion="polite"
            style={{ padding: 12, backgroundColor: theme.colors.surface.inset }}>
            <Text style={{ color: theme.colors.text.primary, fontSize: 13 }}>
                {message} {t('ignorePrevious.connection.actionsUnavailable')}
            </Text>
        </View>
    );
}
