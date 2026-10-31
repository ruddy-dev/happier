import * as React from 'react';
import { View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';

import { SessionView } from '@/components/sessions/shell/SessionView';
import { Text } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';
import { useAllSessions } from '@/sync/store/hooks';
import { t } from '@/text';

import { ContextMeter } from './ContextMeter';
import { MaskFace } from './MaskFace';
import { collectWaits } from './WaitingPanel';

/**
 * The coordinator's chat: Happier's own session view, embedded the way the workspace cockpit
 * embeds it. The mask's bulb lights when anything is waiting on you.
 */
export function CoordinatorPane({ sessionId }: { sessionId: string }) {
    const { theme } = useUnistyles();
    const sessions = useAllSessions();
    const coordinator = React.useMemo(() => sessions.find((s) => s.id === sessionId) ?? null, [sessions, sessionId]);
    const waiting = React.useMemo(() => {
        const { items, unloaded } = collectWaits(sessions);
        return items.length + unloaded.length > 0;
    }, [sessions]);

    return (
        <View style={{ flex: 1, minHeight: 480 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 8 }}>
                <MaskFace size={36} bulb={waiting ? 'turn' : 'rest'} sleepy={false} />
                <Text style={{ color: theme.colors.text.primary, fontSize: 18, ...Typography.default('semiBold') }}>
                    {t('ignorePrevious.coordinator')}
                </Text>
                <View style={{ marginLeft: 'auto' }}>{coordinator ? <ContextMeter session={coordinator} /> : null}</View>
            </View>
            <View style={{ flex: 1 }}>
                <SessionView
                    id={sessionId}
                    routeAnchorOverride={true}
                    surfaceFocusedOverride={true}
                    safeAreaTopMode="internal"
                    headerSafeAreaTopMode="internal"
                    chatBottomSpacing="none"
                />
            </View>
        </View>
    );
}
