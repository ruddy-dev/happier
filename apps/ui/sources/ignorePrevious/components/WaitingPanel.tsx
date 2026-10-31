import * as React from 'react';
import { Pressable, View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';

import { Text } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';
import { useNavigateToSession } from '@/hooks/session/useNavigateToSession';
import { Modal } from '@/modal';
import type { Session } from '@/sync/domains/state/storageTypes';
import { sessionAllow, sessionDeny } from '@/sync/ops';
import { useAllSessions } from '@/sync/store/hooks';
import { t } from '@/text';
import {
    getSessionName,
    getSessionStatus,
    listPendingPermissionRequests,
    listPendingUserActionRequests,
} from '@/utils/sessions/sessionUtils';

import { toWaitingItems, type WaitingItem } from '../model/waitingItems';
import { MaskFace } from './MaskFace';

/** A session that says it is waiting on you, but whose requests live in a transcript not loaded here. */
type UnloadedWait = Readonly<{ sessionId: string; sessionTitle: string }>;

export function collectWaits(sessions: readonly Session[]): { items: WaitingItem[]; unloaded: UnloadedWait[] } {
    const live = sessions.filter((session) => !session.archivedAt);
    const input = live.map((session) => {
        const permissions = listPendingPermissionRequests(session);
        const seen = new Set(permissions.map((request) => request.id));
        const questions = listPendingUserActionRequests(session).filter((request) => !seen.has(request.id));
        return { session, sessionId: session.id, sessionTitle: getSessionName(session), requests: [...permissions, ...questions] };
    });
    const unloaded = input
        .filter(({ session, requests }) => {
            if (requests.length > 0) return false;
            const state = getSessionStatus(session).state;
            return state === 'permission_required' || state === 'action_required';
        })
        .map(({ sessionId, sessionTitle }) => ({ sessionId, sessionTitle }));
    return { items: toWaitingItems(input), unloaded };
}

/**
 * Everything across your sessions that waits on you: commands to allow or deny, questions to
 * answer in their session. Renders nothing when nothing waits. Approving here is the same call the session's own footer makes.
 */
export function WaitingPanel({ compact = false }: { compact?: boolean }) {
    const sessions = useAllSessions();
    const { items, unloaded } = React.useMemo(() => collectWaits(sessions), [sessions]);
    const { theme } = useUnistyles();
    const navigateToSession = useNavigateToSession();

    const answer = React.useCallback(async (call: () => Promise<void>) => {
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
        <Pressable accessibilityRole="button" style={buttonStyle} onPress={() => void navigateToSession(sessionId)}>
            <Text style={buttonText}>{t('ignorePrevious.openSession')}</Text>
        </Pressable>
    );

    // Folds away when nothing waits: the Work counts and the coordinator's bulb already say so.
    if (items.length === 0 && unloaded.length === 0) return null;

    if (compact) {
        return (
            <View accessible accessibilityLabel={t('ignorePrevious.title')} style={{ alignItems: 'center', gap: 2 }}>
                <MaskFace size={32} bulb="turn" sleepy={false} />
                <Text testID="ip-rail-waiting" style={{ color: theme.colors.text.primary, fontSize: 15, ...Typography.default('semiBold') }}>
                    {items.length + unloaded.length}
                </Text>
            </View>
        );
    }

    return (
        <View testID="ip-waiting" style={{ gap: 12 }}>
            <Text style={{ color: theme.colors.text.primary, fontSize: 18, ...Typography.default('semiBold') }}>
                {t('ignorePrevious.title')}
            </Text>
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
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                        {item.kind === 'user_action' ? null : (
                            <>
                                <Pressable
                                    accessibilityRole="button"
                                    style={buttonStyle}
                                    onPress={() => void answer(() => sessionAllow(item.sessionId, item.requestId))}
                                >
                                    <Text style={buttonText}>{t('ignorePrevious.allow', { tool: item.tool })}</Text>
                                </Pressable>
                                <Pressable
                                    accessibilityRole="button"
                                    style={buttonStyle}
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
