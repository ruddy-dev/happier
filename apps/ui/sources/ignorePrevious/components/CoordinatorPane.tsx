import { TranscriptAppearanceContext } from '@/components/sessions/transcript/TranscriptAppearanceContext';
import { useCoordinatorTranscriptAppearance } from '../useCoordinatorTranscriptAppearance';
import * as React from 'react';
import { Platform, Pressable, View, useWindowDimensions } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';

import { isMobileLayoutWidth } from '@/components/sessions/layout/isMobileLayoutWidth';
import type { SessionViewComposerOverrides } from '@/components/sessions/model/sessionComposerOverrides';
import { SessionView } from '@/components/sessions/shell/SessionView';
import { Text } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';
import { useHydrateSessionForRoute } from '@/hooks/session/useHydrateSessionForRoute';
import { Modal } from '@/modal';
import { useSession, useSetting } from '@/sync/store/hooks';
import { t } from '@/text';

import { RunSettingsMenu } from './RunSettingsMenu';
import { ShogRunSettingsMenu } from './ShogRunSettingsMenu';
import { ContextGauge } from './ContextGauge';
import { sessionContextMeter } from './ContextMeter';
import { resolveAgentIdFromFlavor } from '@/agents/catalog/catalog';
import { CoordinatorPrompts } from './CoordinatorPrompts';
import { MaskFace } from './MaskFace';
import { ShogView } from './ShogView';
import { DeskFixtureRouteContext } from '../deskFixtureGate';
import { useWaitingCount } from '../model/useDeskWaits';
import { DeskText } from '../typography/DeskText';
import { useDeskComposerControls } from '../model/useDeskComposerControls';

/**
 * The coordinator's chat: Happier's own session view, embedded the way the workspace cockpit
 * embeds it. The mask's bulb lights when anything is waiting on you. "Shog" is the coordinator's quiet nickname;
 * pressing the mask shows Shog up close.
 */
function openShog() {
    Modal.show({ component: ShogView });
}

/**
 * The dev-only desk fixture route (EXPO_PUBLIC_IP_FIXTURES=1) shows a fixed transcript here, because Happier's
 * chat needs an account. Only that route does: a fixture build's real desk keeps the real chat.
 *
 * The import sits inside the flag comparison, spelled out because Metro folds that away in a production build
 * and does not fold a function call, so a normal build drops the import entirely (Metro's block list for the
 * fixtures folder is the second defence). The import is also directly inside a try block, which Metro counts as
 * an optional dependency, so a dev bundle made without the flag, which does not fold, still builds.
 */
type FixtureBodyProps = { footerLeadingActions?: React.ReactNode; statusTrailingActions?: React.ReactNode };
let fixtureBody: React.ComponentType<FixtureBodyProps> | null = null;
function getFixtureBody(inFixtureRoute: boolean): React.ComponentType<FixtureBodyProps> | null {
    if (process.env.EXPO_PUBLIC_IP_FIXTURES === '1') {
        if (!inFixtureRoute) return null;
        try {
            fixtureBody ??= React.lazy(() =>
                import('../fixtures/CoordinatorBodyStub').then((module) => ({ default: module.CoordinatorBodyStub })),
            );
        } catch (error) {
            throw new Error('Desk fixture could not be loaded', { cause: error });
        }
        return fixtureBody;
    }
    return null;
}

export function CoordinatorPane({ sessionId, headerAccessory }: { sessionId: string; headerAccessory?: React.ReactNode }) {
    const { theme } = useUnistyles();
    const appearance = useCoordinatorTranscriptAppearance();
    const { width: windowWidth } = useWindowDimensions();
    const [chatWidth, setChatWidth] = React.useState(0);
    const enterToSend = useSetting(Platform.OS === 'web' ? 'agentInputEnterToSend' : 'agentInputEnterToSendNative');
    const showEnterHint = enterToSend === true && !isMobileLayoutWidth(windowWidth) && !isMobileLayoutWidth(chatWidth);
    const placeholder = t('ignorePrevious.composer.placeholder');
    const enterHint = t('ignorePrevious.composer.enterHint');
    const coordinator = useSession(sessionId);
    const controls = useDeskComposerControls(sessionId);
    const composer = React.useMemo<SessionViewComposerOverrides>(() => ({
        ...controls,
        placeholder,
        footerLeadingActions: <RunSettingsMenu key={sessionId} />,
        renderFooterLeadingActions: (hostControls) => <ShogRunSettingsMenu key={sessionId} controls={hostControls} />,
        providerUsageGauge: null,
        hide: { ...controls.hide, contextUsage: true },
        statusTrailingActions: (showEnterHint || (coordinator && (sessionContextMeter(coordinator) || resolveAgentIdFromFlavor(coordinator.metadata?.flavor) === 'codex'))) ? <>
            {showEnterHint ? (
                <DeskText testID="ip-composer-enter-hint" style={{ color: theme.colors.text.secondary, fontSize: 12 }}>
                    {enterHint}
                </DeskText>
            ) : null}
            {coordinator ? <ContextGauge session={coordinator} /> : null}
        </> : null,
    }), [placeholder, enterHint, showEnterHint, theme.colors.text.secondary, sessionId, coordinator, controls]);
    // On a cold load the desk knows the coordinator from the sidebar's list before its record has
    // loaded. SessionView doesn't fetch a missing record, so ask for it the way the session route does,
    // and hand SessionView the state so it shows loading or retrying instead of "isn't available".
    const hydration = useHydrateSessionForRoute(sessionId, 'IgnorePrevious.CoordinatorPane');
    const waiting = useWaitingCount() > 0;
    const FixtureBody = getFixtureBody(React.useContext(DeskFixtureRouteContext));

    return (
        <View testID="ip-coordinator-pane" onLayout={(event) => setChatWidth(event.nativeEvent.layout.width)} style={{ flex: 1, minHeight: 480 }}>
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
                    {headerAccessory}
                </View>
            </View>
            <CoordinatorPrompts coordinatorId={sessionId} />
            <View style={{ flex: 1 }}>
                <TranscriptAppearanceContext.Provider value={appearance}>
                    {FixtureBody ? (
                        <React.Suspense fallback={null}>
                            <FixtureBody footerLeadingActions={composer.footerLeadingActions} statusTrailingActions={composer.statusTrailingActions} />
                        </React.Suspense>
                    ) : (
                        <SessionView
                            id={sessionId}
                            composer={composer}
                            routeHydrationState={hydration}
                            routeAnchorOverride={true}
                            surfaceFocusedOverride={true}
                            safeAreaTopMode="internal"
                            headerSafeAreaTopMode="internal"
                            chatBottomSpacing="none"
                        />
                    )}
                </TranscriptAppearanceContext.Provider>
            </View>
        </View>
    );
}
