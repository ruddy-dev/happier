import * as React from 'react';
import { Pressable, View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { createPermissionActionDispatchGuard } from '@/components/tools/shell/permissions/permissionActionDispatchGuard';
import { Text } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';
import { Modal } from '@/modal';
import { sessionAllowResult, sessionDenyResult } from '@/sync/ops';
import type { SessionPermissionResult } from '@/sync/ops/sessions';
import { storage } from '@/sync/domains/state/storage';
import { useSessionListRenderable, useSocketStatus } from '@/sync/store/hooks';
import { t } from '@/text';
import { useDeskNow } from '../model/useDeskNow';
import { workerUnheardMinutes } from '../model/workerFreshness';
import type { WaitingItem } from '../model/waitingItems';

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

type Theme = ReturnType<typeof useUnistyles>['theme'];

export function cardStyles(theme: Theme) {
    return {
        card: { gap: 6, padding: 12, borderRadius: 12, backgroundColor: theme.colors.surface.elevated },
        title: { color: theme.colors.text.primary, fontSize: 15 },
        button: {
            paddingHorizontal: 12,
            paddingVertical: 8,
            borderRadius: 10,
            borderWidth: 1,
            borderColor: theme.colors.border.default,
            backgroundColor: theme.colors.surface.inset,
        },
        buttonText: { color: theme.colors.text.primary, fontSize: 14, ...Typography.default('semiBold') },
        secondary: { color: theme.colors.text.secondary, fontSize: 13 },
    } as const;
}

export function OpenSessionButton({ sessionId, onOpen }: { sessionId: string; onOpen: (sessionId: string) => void }) {
    const { theme } = useUnistyles();
    const styles = cardStyles(theme);
    return (
        <Pressable accessibilityRole="button" style={styles.button} onPress={() => onOpen(sessionId)}>
            <Text style={styles.buttonText}>{t('ignorePrevious.openSession')}</Text>
        </Pressable>
    );
}

/**
 * One request waiting on you. Allow and Deny go through the same dispatch guard as the session's
 * own permission footer, under the same key, so two surfaces (or two presses) never send at once.
 * Once this card's answer is sent its buttons stay off until the request leaves the list; a send
 * that fails turns them back on. The desk holds the request only while its answer is in flight:
 * if the agent never drops the request, the session's footer can still answer it.
 */
export function WaitingCard({ item, issueKey, onOpen, onAnswered }: {
    item: WaitingItem;
    issueKey: string | null;
    onOpen: (sessionId: string) => void;
    onAnswered: (outcome: 'allowed' | 'denied') => void;
    /** 3.3 reports an unsent pick/text here and clears it on send or discard. */
    onDirtyChange?: (dirty: boolean) => void;
}) {
    const { theme } = useUnistyles();
    const styles = cardStyles(theme);
    // The same literal as PermissionFooter's requestKey: the two surfaces arbitrate one request.
    const requestKey = `${item.sessionId}\u0000${item.requestId}`;
    const guardRef = React.useRef<ReturnType<typeof createPermissionActionDispatchGuard> | null>(null);
    if (guardRef.current === null) {
        guardRef.current = createPermissionActionDispatchGuard(requestKey, { holdAfterSuccess: false });
    } else {
        guardRef.current.setRequestKey(requestKey);
    }
    const guard = guardRef.current;

    const [phase, setPhase] = React.useState<'idle' | 'sending' | 'sent'>('idle');
    const busy = phase === 'sending';
    const { status } = useSocketStatus();
    const disconnected = status !== 'connected';
    const disabled = disconnected || phase !== 'idle';
    // Whether this card holds the request (its own answer is in flight or sent). Read in the press
    // handler, where a second press in the same commit can't see the state update yet.
    const holdsRef = React.useRef(false);
    const [elsewhere, setElsewhere] = React.useState(false);

    const send = async (kind: 'allow' | 'deny', call: () => Promise<SessionPermissionResult>) => {
        if (storage.getState().socketStatus !== 'connected') return;
        try {
            // The guard runs the action only when this press wins the request. A press refused
            // while this card is answering changes nothing; one refused because another screen
            // holds the request says so, and the buttons stay on for when that screen lets go.
            const sent = await guard.dispatch(requestKey, async () => {
                holdsRef.current = true;
                setElsewhere(false);
                setPhase('sending');
                const result = await call();
                if (!result.ok) throw result;
            });
            if (sent) { onAnswered(kind === 'allow' ? 'allowed' : 'denied'); setPhase('sent'); }
            else if (!holdsRef.current) setElsewhere(true);
        } catch (error) {
            holdsRef.current = false;
            setPhase('idle');
            const code = typeof error === 'object' && error !== null && 'errorCode' in error ? error.errorCode : null;
            if (code === 'permission_request_not_found' || code === 'permission_request_expired') {
                Modal.alert(t('ignorePrevious.waiting.alreadyAnsweredTitle'), t('ignorePrevious.waiting.alreadyAnswered'));
            } else {
                Modal.alert(t('ignorePrevious.waiting.answerFailedTitle'), t('ignorePrevious.waiting.answerFailed'));
            }
        }
    };

    const answerButton = (kind: 'allow' | 'deny', label: string, call: () => Promise<SessionPermissionResult>) => (
        <Pressable
            testID={`ip-waiting-${kind}-${item.requestId}`}
            accessibilityRole="button"
            accessibilityLabel={label}
            accessibilityState={{ disabled, busy }}
            accessibilityHint={disconnected ? t('ignorePrevious.connection.actionsUnavailable') : undefined}
            disabled={disabled}
            style={[styles.button, disabled ? { opacity: 0.5 } : null]}
            // Not awaited: the press returns at once and the guard owns the in-flight answer.
            onPress={() => void send(kind, call)}
        >
            <Text style={styles.buttonText}>{label}</Text>
        </Pressable>
    );

    return (
        <View testID={`ip-waiting-card-${item.requestId}`} style={styles.card}>
            <Text style={styles.title}>{item.sessionTitle}</Text>
            <Text testID={`ip-waiting-issue-${item.requestId}`} style={styles.secondary}>{issueKey ?? t('ignorePrevious.noIssue')}</Text>
            {item.kind === 'user_action' ? (
                <Text style={styles.secondary}>{t('ignorePrevious.question')}</Text>
            ) : (
                <>
                    {item.agentNote ? (
                        <Text style={styles.secondary}>
                            {t('ignorePrevious.agentSays', { name: item.sessionTitle })} {item.agentNote}
                        </Text>
                    ) : null}
                    {/* Whole and selectable: what Allow runs must be readable to its last character. */}
                    <Text selectable style={{ color: theme.colors.text.primary, fontSize: 13, ...Typography.mono() }}>
                        {item.detail}
                    </Text>
                </>
            )}
            {item.kind === 'user_action' ? null : (
                <StaleRequestNote sessionId={item.sessionId} requestId={item.requestId} />
            )}
            {item.kind !== 'user_action' && item.disabledReason ? (
                <Text style={styles.secondary}>
                    {item.disabledReason === 'readOnly'
                        ? t('session.sharing.permissionApprovalsDisabledReadOnly')
                        : t('session.sharing.permissionApprovalsDisabledNotGranted')}
                </Text>
            ) : null}
            {elsewhere ? (
                <Text testID={`ip-waiting-elsewhere-${item.requestId}`} style={styles.secondary}>
                    {t('ignorePrevious.waiting.answeringElsewhere')}
                </Text>
            ) : null}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {item.kind === 'user_action' || item.disabledReason ? null : (
                    <>
                        {answerButton('allow', t('ignorePrevious.allow', { tool: item.tool }), () =>
                            sessionAllowResult(item.sessionId, item.requestId),
                        )}
                        {answerButton('deny', t('ignorePrevious.deny'), () =>
                            sessionDenyResult(item.sessionId, item.requestId, undefined, undefined, 'denied'),
                        )}
                    </>
                )}
                <OpenSessionButton sessionId={item.sessionId} onOpen={onOpen} />
            </View>
        </View>
    );
}
