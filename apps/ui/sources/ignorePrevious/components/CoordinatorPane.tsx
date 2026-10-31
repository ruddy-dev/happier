import * as React from 'react';
import { Pressable, View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';

import { SessionView } from '@/components/sessions/shell/SessionView';
import { Text } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';
import { Modal } from '@/modal';
import { useSession } from '@/sync/store/hooks';
import { t } from '@/text';

import { ContextMeter } from './ContextMeter';
import { CoordinatorPrompts } from './CoordinatorPrompts';
import { MaskFace } from './MaskFace';
import { ShogView } from './ShogView';
import { useWaitingCount } from './WaitingPanel';

/**
 * The coordinator's chat: Happier's own session view, embedded the way the workspace cockpit
 * embeds it. The mask's bulb lights when anything is waiting on you. "Shog" is the coordinator's quiet nickname;
 * pressing the mask shows Shog up close.
 */
function openShog() {
    Modal.show({ component: ShogView });
}

export function CoordinatorPane({ sessionId, headerAccessory }: { sessionId: string; headerAccessory?: React.ReactNode }) {
    const { theme } = useUnistyles();
    // The meter needs the full record; it appears once the coordinator's record has loaded.
    const coordinator = useSession(sessionId);
    const waiting = useWaitingCount() > 0;

    return (
        <View style={{ flex: 1, minHeight: 480 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 8 }}>
                <Pressable
                    testID="ip-shog-open"
                    accessibilityRole="button"
                    accessibilityLabel={t('ignorePrevious.openShog')}
                    onPress={openShog}
                    hitSlop={6}
                >
                    <MaskFace size={36} bulb={waiting ? 'turn' : 'rest'} sleepy={false} />
                </Pressable>
                <Text style={{ color: theme.colors.text.primary, fontSize: 18, ...Typography.default('semiBold') }}>
                    {t('ignorePrevious.coordinator')}
                </Text>
                <Text style={{ color: theme.colors.text.secondary, fontSize: 13 }}>{t('ignorePrevious.coordinatorNickname')}</Text>
                <View style={{ marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                    {coordinator ? <ContextMeter session={coordinator} /> : null}
                    {headerAccessory}
                </View>
            </View>
            <CoordinatorPrompts coordinatorId={sessionId} />
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
