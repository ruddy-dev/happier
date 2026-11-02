import * as React from 'react';
import { Pressable, View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';

import { SessionView } from '@/components/sessions/shell/SessionView';
import { Text } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';
import { useHydrateSessionForRoute } from '@/hooks/session/useHydrateSessionForRoute';
import { Modal } from '@/modal';
import { useSession } from '@/sync/store/hooks';
import { t } from '@/text';

import { ContextMeter } from './ContextMeter';
import { CoordinatorPrompts } from './CoordinatorPrompts';
import { MaskFace } from './MaskFace';
import { ShogView } from './ShogView';
import { useWaitingCount } from '../model/useDeskWaits';

/**
 * The coordinator's chat: Happier's own session view, embedded the way the workspace cockpit
 * embeds it. The mask's bulb lights when anything is waiting on you. "Shog" is the coordinator's quiet nickname;
 * pressing the mask shows Shog up close.
 */
function openShog() {
    Modal.show({ component: ShogView });
}

/**
 * Fixture builds (EXPO_PUBLIC_IP_FIXTURES=1) show a fixed transcript here, because Happier's chat needs
 * an account. The import sits inside the check so a normal build folds it away and ships nothing.
 */
let fixtureBody: React.ComponentType | null = null;
function getFixtureBody(): React.ComponentType | null {
    if (process.env.EXPO_PUBLIC_IP_FIXTURES === '1') {
        fixtureBody ??= React.lazy(() =>
            import('../fixtures/CoordinatorBodyStub').then((module) => ({ default: module.CoordinatorBodyStub })),
        );
        return fixtureBody;
    }
    return null;
}

export function CoordinatorPane({ sessionId, headerAccessory }: { sessionId: string; headerAccessory?: React.ReactNode }) {
    const { theme } = useUnistyles();
    // The meter needs the full record; it appears once the coordinator's record has loaded.
    const coordinator = useSession(sessionId);
    // On a cold load the desk knows the coordinator from the sidebar's list before its record has
    // loaded. SessionView doesn't fetch a missing record, so ask for it the way the session route does,
    // and hand SessionView the state so it shows loading or retrying instead of "isn't available".
    const hydration = useHydrateSessionForRoute(sessionId, 'IgnorePrevious.CoordinatorPane');
    const waiting = useWaitingCount() > 0;
    const FixtureBody = getFixtureBody();

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
                {FixtureBody ? (
                    <React.Suspense fallback={null}>
                        <FixtureBody />
                    </React.Suspense>
                ) : (
                    <SessionView
                        id={sessionId}
                        routeHydrationState={hydration}
                        routeAnchorOverride={true}
                        surfaceFocusedOverride={true}
                        safeAreaTopMode="internal"
                        headerSafeAreaTopMode="internal"
                        chatBottomSpacing="none"
                    />
                )}
            </View>
        </View>
    );
}
