import { TranscriptAppearanceContext } from '@/components/sessions/transcript/TranscriptAppearanceContext';
import { useCoordinatorTranscriptAppearance } from '../useCoordinatorTranscriptAppearance';
import * as React from 'react';
import { Platform, View, useWindowDimensions } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';

import { isMobileLayoutWidth } from '@/components/sessions/layout/isMobileLayoutWidth';
import type { SessionViewComposerOverrides } from '@/components/sessions/model/sessionComposerOverrides';
import { SessionView } from '@/components/sessions/shell/SessionView';
import { useHydrateSessionForRoute } from '@/hooks/session/useHydrateSessionForRoute';
import { useSession, useSetting } from '@/sync/store/hooks';
import { t } from '@/text';

import { RunSettingsMenu } from './RunSettingsMenu';
import { ShogRunSettingsMenu } from './ShogRunSettingsMenu';
import { ContextGauge } from './ContextGauge';
import { sessionContextMeter } from './ContextMeter';
import { resolveAgentIdFromFlavor } from '@/agents/catalog/catalog';
import { CoordinatorPrompts } from './CoordinatorPrompts';
import { CoordinatorHeader } from './CoordinatorHeader';
import { ShogView } from './ShogView';
import { DeskFixtureRouteContext } from '../deskFixtureGate';
import { DeskText } from '../typography/DeskText';
import { FloatingOverlay } from '@/components/ui/overlays/FloatingOverlay';
import { useDeskPopup } from '../popups/useDeskPopup';
import { useDeskComposerControls } from '../model/useDeskComposerControls';
import { useDeskDictationControls } from '../model/useDeskDictation';

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

/**
 * The coordinator's chat: Happier's own session view, embedded the way the workspace cockpit
 * embeds it. The mask's bulb lights when anything is waiting on you. "Shog" is the coordinator's quiet nickname;
 * pressing the mask shows Shog up close.
 */
export function CoordinatorPane({ sessionId, headerAccessory }: { sessionId: string; headerAccessory?: React.ReactNode }) {
    const { theme } = useUnistyles();
    const appearance = useCoordinatorTranscriptAppearance();
    const { width: windowWidth, height: windowHeight } = useWindowDimensions();
    const [shogOpen, setShogOpen] = React.useState(false);
    const shogOpenerRef = React.useRef<View>(null);
    const shogCreatureOpenerRef = React.useRef<View>(null);
    const shogContentRef = React.useRef<View>(null);
    const shogPanelId = React.useId();
    const closeShog = () => setShogOpen(false);
    useDeskPopup({ open: shogOpen, onClose: closeShog, openerRef: shogOpenerRef,
        pointerOpenerRef: shogCreatureOpenerRef, contentRef: shogContentRef, returnFocusOnClose: true });
    // Mockup 12 keeps this overlay below the header and above the transcript, clear of the composer.
    const shogHeight = Math.max(200, Math.min(470, windowHeight - 340));
    const [chatWidth, setChatWidth] = React.useState(0);
    const enterToSend = useSetting(Platform.OS === 'web' ? 'agentInputEnterToSend' : 'agentInputEnterToSendNative');
    const showEnterHint = enterToSend === true && !isMobileLayoutWidth(windowWidth) && !isMobileLayoutWidth(chatWidth);
    const placeholder = t('ignorePrevious.composer.placeholder');
    const enterHint = t('ignorePrevious.composer.enterHint');
    const coordinator = useSession(sessionId);
    const controls = useDeskDictationControls(sessionId, useDeskComposerControls(sessionId));
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
    const FixtureBody = getFixtureBody(React.useContext(DeskFixtureRouteContext));

    return (
        <View testID="ip-coordinator-pane" onLayout={(event) => setChatWidth(event.nativeEvent.layout.width)} style={{ flex: 1, minHeight: 480 }}>
            <View style={{ position: 'relative', zIndex: 2 }}>
                <CoordinatorHeader session={coordinator} onOpenShog={() => setShogOpen(open => !open)}
                    shogOpen={shogOpen} shogOpenerRef={shogOpenerRef} shogCreatureOpenerRef={shogCreatureOpenerRef}
                    shogPanelId={shogPanelId} accessory={headerAccessory} />
                {shogOpen ? <View style={{ position: 'absolute', top: '100%', left: 0, right: 0 }}>
                    <FloatingOverlay maxHeight={shogHeight}>
                        <ShogView onClose={closeShog} contentRef={shogContentRef} panelId={shogPanelId} height={shogHeight} />
                    </FloatingOverlay>
                </View> : null}
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
                            showHeader={false}
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
