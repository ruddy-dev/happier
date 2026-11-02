import { View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { Text } from '@/components/ui/text/Text';
import { useLastSyncAt, useSocketStatus } from '@/sync/store/hooks';
import { t } from '@/text';

/** The sync store owns both connection state and the last successful data sync. */
export function DeskConnectionBanner() {
    const { status } = useSocketStatus();
    const lastSyncAt = useLastSyncAt();
    const { theme } = useUnistyles();
    if (status === 'connected') return null;
    const message = lastSyncAt !== null
        ? t('ignorePrevious.connection.lastSeen', {
            time: new Date(lastSyncAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }),
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
