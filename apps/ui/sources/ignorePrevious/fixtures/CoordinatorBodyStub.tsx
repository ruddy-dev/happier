/**
 * Dev-only stand-in for the coordinator's chat in fixture builds. Happier's chat needs an account
 * (without one it shows "Restore with Secret Key"), so the fixture shows a local transcript instead.
 * Loaded only by CoordinatorPane when EXPO_PUBLIC_IP_FIXTURES=1; never import it anywhere else.
 */
import * as React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';

import { Text } from '@/components/ui/text/Text';
import { AgentInput } from '@/components/sessions/agentInput/AgentInput';
import type { PermissionMode } from '@/sync/domains/permissions/permissionTypes';
import { t } from '@/text';
import { useReducedMotionPreference } from '@/hooks/ui/useReducedMotionPreference';
import { isHostVisible, isRuntimeActive, subscribeToRuntimeActiveChange } from '@/utils/runtime/isRuntimeActive';
import { DeskText } from '../typography/DeskText';
import { getDemoConversation } from './demoConversation';

import scenario from './desk-fixture.json';
import demo from './demo/desk-demo.json';
import { storage } from '@/sync/domains/state/storage';
import { CreatureFixture } from './CreatureFixture';
import { FreshStartFixture } from './FreshStartFixture';

// No session operations or remote discovery in the synthetic route. All edits stay local.
const noSend = () => {};
const noSuggestions = async () => [];
const noFileViewer = () => {};
const autocompleteKinds = [] as const;
const subscribeIdle = () => () => {};
// useSyncExternalStore needs a stable snapshot for the original, non-player fixture.
const idleTranscript = { status: 'idle' as const, started: false, step: 0, transcript: scenario.coordinatorBody.transcript };
const getIdleSnapshot = () => idleTranscript;

export function CoordinatorBodyStub({ footerLeadingActions, statusTrailingActions }: { footerLeadingActions?: React.ReactNode; statusTrailingActions?: React.ReactNode }) {
    const { theme } = useUnistyles();
    const [draft, setDraft] = React.useState('');
    const [permissionMode, setPermissionMode] = React.useState<PermissionMode>('plan');
    const hasDemo = storage(state => Boolean(state.sessions[demo.coordinatorId]));
    const player = hasDemo ? getDemoConversation() : null;
    const playback = React.useSyncExternalStore(player?.subscribe ?? subscribeIdle, player?.getSnapshot ?? getIdleSnapshot);
    const transcript = playback.transcript;
    const reducedMotion = useReducedMotionPreference();
    const scroll = React.useRef<ScrollView>(null);
    React.useEffect(() => {
        if (!player) return;
        const pauseHidden = () => { if (!isRuntimeActive() || !isHostVisible()) player.pause(); };
        const unsubscribe = subscribeToRuntimeActiveChange(pauseHidden);
        pauseHidden();
        return () => { unsubscribe(); player.pause(); };
    }, [player]);
    const state = player ? playback : null;
    const label = state?.status === 'playing' ? t('ignorePrevious.demo.pause')
        : state?.status === 'paused' ? t('ignorePrevious.demo.resume') : t('ignorePrevious.demo.simulate');
    const buttonStyle = { minHeight: 48, paddingHorizontal: 12, justifyContent: 'center' as const,
        borderWidth: 1, borderRadius: 10, borderColor: theme.colors.border.default, backgroundColor: theme.colors.surface.elevated };

    return (
        <View style={{ flex: 1 }}>
            {player && state ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, padding: 12 }}>
                <Pressable testID="ip-demo-play" accessibilityRole="button" accessibilityLabel={label}
                    onPress={state.status === 'playing' ? player.pause : player.play} style={buttonStyle}>
                    <DeskText style={{ color: theme.colors.text.primary }}>{label}</DeskText>
                </Pressable>
                {state.started ? <Pressable testID="ip-demo-restart" accessibilityRole="button" accessibilityLabel={t('ignorePrevious.demo.restart')}
                    onPress={player.restart} style={buttonStyle}>
                    <DeskText style={{ color: theme.colors.text.primary }}>{t('ignorePrevious.demo.restart')}</DeskText>
                </Pressable> : null}
            </View> : null}
            <ScrollView ref={scroll} testID="ip-fixture-coordinator-body" style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1, justifyContent: 'space-between' }}
                onContentSizeChange={() => {
                    if (state?.started && state.step > 0 && state.status !== 'paused') {
                        scroll.current?.scrollToEnd({ animated: !reducedMotion });
                    }
                }}>
                {!hasDemo ? <><CreatureFixture /><FreshStartFixture /></> : null}
                <View style={{ gap: 10, padding: 16 }}>
                    {transcript.map((line, index) => {
                        const mine = line.from === 'you';
                        return (
                            <View
                                key={index}
                                style={{
                                    alignSelf: mine ? 'flex-end' : 'flex-start',
                                    maxWidth: '80%',
                                    paddingHorizontal: 12,
                                    paddingVertical: 8,
                                    borderRadius: 12,
                                    backgroundColor: mine ? theme.colors.surface.elevated : theme.colors.surface.inset,
                                }}
                            >
                                <Text style={{ color: theme.colors.text.primary, fontSize: 14 }}>{line.text}</Text>
                            </View>
                        );
                    })}
                </View>
            </ScrollView>
            <AgentInput sessionId={hasDemo ? demo.coordinatorId : scenario.coordinatorId}
                value={draft} onChangeText={setDraft} placeholder={t('ignorePrevious.composer.placeholder')}
                onSend={noSend} isSendDisabled={true} agentType="claude"
                permissionMode={permissionMode} onPermissionModeChange={setPermissionMode}
                onFileViewerPress={noFileViewer} autocompleteKinds={autocompleteKinds} autocompleteSuggestions={noSuggestions}
                footerLeadingActions={footerLeadingActions} statusTrailingActions={statusTrailingActions}
                hideContextUsage={true} providerUsageGauge={null} />
        </View>
    );
}
