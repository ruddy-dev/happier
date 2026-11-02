import * as React from 'react';
import { Pressable, View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';

import { Text } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';
import { useNavigateToSession } from '@/hooks/session/useNavigateToSession';
import { Modal } from '@/modal';
import { sessionAllow, sessionDeny } from '@/sync/ops';
import { storage } from '@/sync/domains/state/storage';
import { useSessionListRenderable, useSocketStatus } from '@/sync/store/hooks';
import { t } from '@/text';

import { useDeskNow } from '../model/useDeskNow';
import { workerUnheardMinutes } from '../model/workerFreshness';
import { useDeskWaits } from '../model/useDeskWaits';

function StaleRequestNote({ sessionId, requestId }: { sessionId: string; requestId: string }) {
    const session = useSessionListRenderable(sessionId);
    const now = useDeskNow();
    const { theme } = useUnistyles();
    if (!session || workerUnheardMinutes(session, now) === null) return null;
    return (
        <Text testID={`ip-waiting-stale-${requestId}`} style={{ color: theme.colors.text.secondary, fontSize: 13 }}>
            {t('ignorePrevious.connection.staleRequest')}
        </Text>
    );
}

/**
 * Everything across your sessions that waits on you: commands to allow or deny, questions to
 * answer in their session. The body of the desk's approvals drawer, which carries the title.
 * Approving here is the same call the session's own footer makes. `onOpenSession` runs after it
 * opens a session, so a card holding the panel can get out of the way.
 */
export function WaitingPanel({ onOpenSession }: { onOpenSession?: () => void } = {}) {
    const { items, unloaded, ready } = useDeskWaits();
    const { theme } = useUnistyles();
    const navigateToSession = useNavigateToSession();
    const { status } = useSocketStatus();
    const disconnected = status !== 'connected';

    const answer = React.useCallback(async (call: () => Promise<void>) => {
        if (storage.getState().socketStatus !== 'connected') return;
        try {
            await call();
        } catch {
            Modal.alert(t('ignorePrevious.allowFailedTitle'), t('ignorePrevious.allowFailed'));
        }
    }, []);

    const buttonStyle = {
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: theme.colors.border.default,
        backgroundColor: theme.colors.surface.inset,
    } as const;
    const buttonText = { color: theme.colors.text.primary, fontSize: 14, ...Typography.default('semiBold') };
    const secondary = { color: theme.colors.text.secondary, fontSize: 13 };

    const openButton = (sessionId: string) => (
        <Pressable accessibilityRole="button" style={buttonStyle} onPress={() => {
            void navigateToSession(sessionId);
            onOpenSession?.();
        }}>
            <Text style={buttonText}>{t('ignorePrevious.openSession')}</Text>
        </Pressable>
    );

    // Before the first sync the desk doesn't know what waits; saying nothing waits would be false.
    if (!ready) {
        return (
            <Text testID="ip-waiting-connecting" style={secondary}>
                {t('ignorePrevious.connecting')}
            </Text>
        );
    }

    if (items.length === 0 && unloaded.length === 0) {
        return (
            <Text testID="ip-waiting-empty" style={secondary}>
                {t('ignorePrevious.nothingWaits')}
            </Text>
        );
    }

    return (
        <View testID="ip-waiting" style={{ gap: 12 }}>
            {items.map((item) => (
                <View
                    key={item.key}
                    style={{ gap: 6, padding: 12, borderRadius: 12, backgroundColor: theme.colors.surface.elevated }}
                >
                    <Text style={{ color: theme.colors.text.primary, fontSize: 15 }}>{item.sessionTitle}</Text>
                    {item.kind === 'user_action' ? (
                        <Text style={secondary}>{t('ignorePrevious.question')}</Text>
                    ) : (
                        <>
                            {item.agentNote ? (
                                <Text style={secondary}>
                                    {t('ignorePrevious.agentSays', { name: item.sessionTitle })} {item.agentNote}
                                </Text>
                            ) : null}
                            <Text style={{ color: theme.colors.text.primary, fontSize: 13, ...Typography.mono() }}>
                                {item.summary}
                            </Text>
                        </>
                    )}
                    {item.kind === 'user_action' ? null : (
                        <StaleRequestNote sessionId={item.sessionId} requestId={item.requestId} />
                    )}
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                        {item.kind === 'user_action' ? null : (
                            <>
                                <Pressable
                                    accessibilityRole="button"
                                    disabled={disconnected}
                                    accessibilityState={{ disabled: disconnected }}
                                    accessibilityHint={disconnected ? t('ignorePrevious.connection.actionsUnavailable') : undefined}
                                    style={[buttonStyle, disconnected ? { opacity: 0.5 } : null]}
                                    onPress={() => void answer(() => sessionAllow(item.sessionId, item.requestId))}
                                >
                                    <Text style={buttonText}>{t('ignorePrevious.allow', { tool: item.tool })}</Text>
                                </Pressable>
                                <Pressable
                                    accessibilityRole="button"
                                    disabled={disconnected}
                                    accessibilityState={{ disabled: disconnected }}
                                    accessibilityHint={disconnected ? t('ignorePrevious.connection.actionsUnavailable') : undefined}
                                    style={[buttonStyle, disconnected ? { opacity: 0.5 } : null]}
                                    onPress={() => void answer(() => sessionDeny(item.sessionId, item.requestId))}
                                >
                                    <Text style={buttonText}>{t('ignorePrevious.deny')}</Text>
                                </Pressable>
                            </>
                        )}
                        {openButton(item.sessionId)}
                    </View>
                </View>
            ))}
            {unloaded.map((wait) => (
                <View
                    key={`unloaded:${wait.sessionId}`}
                    style={{ gap: 6, padding: 12, borderRadius: 12, backgroundColor: theme.colors.surface.elevated }}
                >
                    <Text style={{ color: theme.colors.text.primary, fontSize: 15 }}>{wait.sessionTitle}</Text>
                    <Text style={secondary}>{t('ignorePrevious.needsLook')}</Text>
                    <View style={{ flexDirection: 'row' }}>{openButton(wait.sessionId)}</View>
                </View>
            ))}
        </View>
    );
}
