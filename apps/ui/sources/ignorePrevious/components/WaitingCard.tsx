import * as React from 'react';
import { useStore } from 'zustand';
import { Platform, Pressable, View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { createPermissionActionDispatchGuard } from '@/components/tools/shell/permissions/permissionActionDispatchGuard';
import { resolveWaitingQuestions } from '../model/waitingQuestions';
import { WaitingQuestion } from './WaitingQuestion';
import { DeskText as Text } from '../typography/DeskText';
import { Typography } from '@/constants/Typography';
import { Modal } from '@/modal';
import { sessionAllowResult, sessionDenyResult } from '@/sync/ops';
import type { SessionPermissionResult } from '@/sync/ops/sessions';
import { storage } from '@/sync/domains/state/storage';
import { useSessionListRenderable, useSocketStatus } from '@/sync/store/hooks';
import { t } from '@/text';
import { useDeskNow } from '../model/useDeskNow';
import { workerLastSignalAt, workerUnheardMinutes } from '../model/workerFreshness';
import { waitingItemGenerationKey, type WaitingItem } from '../model/waitingItems';
import { readDeskWaits } from '../model/useDeskWaits';
import { useDeskPref } from '../deskPrefs';
import { forgetWaitingAction, idleWaitingAction, setWaitingAction, type WaitingHistory } from '../model/waitingHistory';

function StaleRequestNote({ sessionId, requestId }: { sessionId: string; requestId: string }) {
    const session = useSessionListRenderable(sessionId);
    const now = useDeskNow();
    const { theme } = useUnistyles();
    const unknown = !session || session.active !== true || workerLastSignalAt(session) === null;
    if (!unknown && workerUnheardMinutes(session, now) === null) return null;
    return (
        <Text testID={`ip-waiting-stale-${requestId}`} style={{ color: theme.colors.text.secondary, fontSize: 13 }}>
            {unknown ? t('ignorePrevious.waiting.workerUnknown') : t('ignorePrevious.connection.staleRequest')}
        </Text>
    );
}

type Theme = ReturnType<typeof useUnistyles>['theme'];

export function cardStyles(theme: Theme) {
    return {
        card: { gap: 6, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: theme.colors.border.default },
        title: { color: theme.colors.text.primary, fontSize: 15 },
        button: {
            paddingHorizontal: 12,
            paddingVertical: 8,
            minHeight: 48,
            justifyContent: 'center',
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
 * One request waiting on you. All answers go through the same dispatch guard as the session's
 * own permission footer, under the same key, so two surfaces (or two presses) never send at once.
 * Sent and expired/missing results keep this card's buttons off while the request stays listed;
 * other send failures permit retry. The desk holds the shared guard only while sending:
 * if the agent never drops the request, the session's footer can still answer it.
 */
export function WaitingCard({ item, issueKey, onOpen, actions, onDirtyChange, onFocusedRemoval, refreshing = false, isCoordinator = false }: {
    item: WaitingItem;
    isCoordinator?: boolean;
    issueKey: string | null;
    onOpen: (sessionId: string) => void;
    actions: WaitingHistory;
    /** 3.3 reports an unsent pick/text here and clears it on send or discard. */
    onDirtyChange?: (dirty: boolean) => void;
    onFocusedRemoval?: () => void;
    refreshing?: boolean;
}) {
    const { theme } = useUnistyles();
    const styles = cardStyles(theme);
    const [chatStyle] = useDeskPref('chatStyle');
    const terminal = chatStyle === 'terminal';
    const [disclosure, setDisclosure] = React.useState<'unopened' | 'open' | 'closed'>('unopened');
    const content = item.requestContent;
    const [reviewedContent, setReviewedContent] = React.useState<string | null>(null);
    const [blockedByChange, setBlockedByChange] = React.useState(false);
    const changed = blockedByChange || (reviewedContent !== null && reviewedContent !== content);
    const expanded = disclosure === 'open' && !changed;
    const [focused, setFocused] = React.useState(false);
    const rowRef = React.useRef<View>(null);
    const toggleRef = React.useRef<View>(null);
    React.useLayoutEffect(() => {
        const row = rowRef.current;
        return () => {
            if (Platform.OS === 'web' && typeof HTMLElement !== 'undefined' && row instanceof HTMLElement
                && row.contains(document.activeElement)) onFocusedRemoval?.();
        };
    }, [onFocusedRemoval]);
    React.useLayoutEffect(() => {
        if (changed && Platform.OS === 'web' && typeof HTMLElement !== 'undefined'
            && rowRef.current instanceof HTMLElement && rowRef.current.contains(document.activeElement)
            && toggleRef.current instanceof HTMLElement) toggleRef.current.focus();
    }, [changed]);

    return (
        <View ref={rowRef} testID={`ip-waiting-card-${item.requestId}`}
            style={{ borderBottomWidth: 1, borderBottomColor: theme.colors.border.default }}>
            <Pressable ref={toggleRef} testID={`ip-waiting-toggle-${item.requestId}`} accessibilityRole="button"
                accessibilityLabel={t(expanded ? 'ignorePrevious.waiting.hideDetails' : 'ignorePrevious.waiting.showDetails', {
                    name: item.sessionTitle, issue: issueKey ?? t('ignorePrevious.noIssue'), summary: item.summary,
                })}
                accessibilityState={{ expanded }} aria-expanded={expanded}
                onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
                onPress={() => {
                    if (expanded) setDisclosure('closed');
                    else { setReviewedContent(content); setBlockedByChange(false); setDisclosure('open'); }
                }}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 52, paddingVertical: 10,
                    paddingHorizontal: 4, backgroundColor: focused ? theme.colors.surface.inset : 'transparent',
                    borderRadius: terminal ? 0 : 6,
                    borderWidth: 1, borderColor: focused ? theme.colors.border.strong : 'transparent' }}>
                <Text testID={`ip-waiting-cursor-${item.requestId}`} accessible={false}
                    style={{ color: theme.colors.text.primary, width: 12 }}>{terminal && focused ? '›' : expanded ? '−' : '+'}</Text>
                <Text numberOfLines={1} style={{ color: theme.colors.text.primary, fontSize: 13, flex: 1, minWidth: 0 }}>{item.summary}</Text>
                <Text testID={`ip-waiting-issue-${item.requestId}`} numberOfLines={1}
                    style={{ ...styles.secondary, fontSize: 11, maxWidth: '30%' }}>{issueKey ?? t('ignorePrevious.noIssue')}</Text>
            </Pressable>
            {changed ? <Text testID={`ip-waiting-changed-${item.requestId}`} accessibilityRole="alert"
                accessibilityLiveRegion="polite" style={styles.secondary}>{t('ignorePrevious.waiting.requestChanged')}</Text> : null}
            {/* Mount details on first demand, then retain the draft and guard across collapse. */}
            {disclosure !== 'unopened' ? <View testID={`ip-waiting-detail-${item.requestId}`}
                accessibilityElementsHidden={!expanded} importantForAccessibility={expanded ? 'auto' : 'no-hide-descendants'}
                style={{ display: expanded ? 'flex' : 'none', gap: 8, paddingHorizontal: 6, paddingBottom: 12 }}>
            <Text style={styles.title}>{item.sessionTitle}</Text>
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
            {item.kind === 'user_action' ? null : <StaleRequestNote sessionId={item.sessionId} requestId={item.requestId} />}
            <WaitingAnswers key={waitingItemGenerationKey(item)} item={item} expanded={expanded} refreshing={refreshing}
                actions={actions} isCoordinator={isCoordinator}
                onOpen={onOpen} onDirtyChange={onDirtyChange} onRequestChanged={() => {
                    setBlockedByChange(true);
                    setDisclosure('closed');
                }} />
            </View> : null}
        </View>
    );
}

/** Answer state belongs to the exact raw content. Disclosure and focus stay with the inbox row. */
function WaitingAnswers({ item, expanded, refreshing, actions, isCoordinator, onOpen, onDirtyChange, onRequestChanged }: {
    item: WaitingItem;
    expanded: boolean;
    refreshing: boolean;
    actions: WaitingHistory;
    isCoordinator: boolean;
    onOpen: (sessionId: string) => void;
    onDirtyChange?: (dirty: boolean) => void;
    onRequestChanged: () => void;
}) {
    const { theme } = useUnistyles();
    const styles = cardStyles(theme);
    const content = item.requestContent;
    const mounted = React.useRef(true);
    React.useLayoutEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; };
    }, []);
    // The same literal as PermissionFooter's requestKey: the two surfaces arbitrate one request.
    const requestKey = `${item.sessionId}\u0000${item.requestId}`;
    const guardRef = React.useRef<ReturnType<typeof createPermissionActionDispatchGuard> | null>(null);
    if (guardRef.current === null) {
        guardRef.current = createPermissionActionDispatchGuard(requestKey, { holdAfterSuccess: false });
    } else {
        guardRef.current.setRequestKey(requestKey);
    }
    const guard = guardRef.current;

    const generation = waitingItemGenerationKey(item);
    const action = useStore(actions, state => state.actions.get(generation) ?? idleWaitingAction);
    const { phase } = action;
    const busy = phase === 'sending';
    const { status } = useSocketStatus();
    const disconnected = status !== 'connected';
    const disabled = disconnected || refreshing || phase !== 'idle' || !expanded;
    const request = storage(state => state.sessions[item.sessionId]?.agentState?.requests?.[item.requestId]);
    const questions = React.useMemo(() => {
        if (isCoordinator || item.kind !== 'user_action') return null;
        return resolveWaitingQuestions(request);
    }, [request, item.kind, isCoordinator]);

    const send = async (kind: 'allow' | 'deny', call: () => Promise<SessionPermissionResult | void>) => {
        if (!mounted.current || disabled || (actions.getState().actions.get(generation) ?? idleWaitingAction).phase !== 'idle'
            || storage.getState().socketStatus !== 'connected' || !storage.getState().isDataReady) return;
        // A request can change between the displayed detail and this press, before React commits.
        const current = readDeskWaits().items.find(current => current.key === item.key);
        if (!current || current.disabledReason) return;
        if (current.requestContent !== content) {
            onRequestChanged();
            return;
        }
        const sending = { phase: 'sending' } as const;
        try {
            // The guard runs the action only when this press wins the request. A press refused
            // while this card is answering changes nothing; one refused because another screen
            // holds the request says so, and the buttons stay on for when that screen lets go.
            const sent = await guard.dispatch(requestKey, async () => {
                setWaitingAction(actions, generation, sending);
                const result = await call();
                if (result && !result.ok) throw result;
            });
            if (sent && actions.getState().actions.get(generation) === sending) {
                const outcome = kind === 'allow' ? 'allowed' : 'denied';
                setWaitingAction(actions, generation, { phase: 'sent', outcome });
            } else if (!sent && (actions.getState().actions.get(generation) ?? idleWaitingAction).phase === 'idle') {
                setWaitingAction(actions, generation, { phase: 'idle', elsewhere: true });
            }
        } catch (error) {
            // This completion belongs to the reviewed version, even if the row now shows another.
            if (actions.getState().actions.get(generation) !== sending) return;
            if (readDeskWaits().items.find(current => current.key === item.key)?.requestContent !== content) {
                forgetWaitingAction(actions, generation);
                return;
            }
            const code = typeof error === 'object' && error !== null && 'errorCode' in error ? error.errorCode : null;
            if (code === 'permission_request_not_found' || code === 'permission_request_expired') {
                setWaitingAction(actions, generation, { phase: 'unavailable', outcome: 'unavailable' });
                Modal.alert(t('ignorePrevious.waiting.alreadyAnsweredTitle'), t('ignorePrevious.waiting.alreadyAnswered'));
            } else if (questions) {
                setWaitingAction(actions, generation, { phase: 'idle', error: true });
            } else {
                setWaitingAction(actions, generation, { phase: 'idle' });
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
            aria-busy={busy}
            accessibilityHint={disconnected ? t('ignorePrevious.connection.actionsUnavailable') : undefined}
            disabled={disabled}
            style={[styles.button, disabled ? { opacity: 0.5 } : null]}
            // Not awaited: the press returns at once and the guard owns the in-flight answer.
            onPress={() => void send(kind, call)}
        >
            <Text style={styles.buttonText}>{label}</Text>
        </Pressable>
    );

    return <>
            {phase === 'unavailable' ? <Text style={styles.secondary}>{t('ignorePrevious.waiting.alreadyAnswered')}</Text> : null}
            {item.disabledReason ? (
                <Text style={styles.secondary}>
                    {item.disabledReason === 'readOnly'
                        ? t('session.sharing.permissionApprovalsDisabledReadOnly')
                        : t('session.sharing.permissionApprovalsDisabledNotGranted')}
                </Text>
            ) : null}
            {action.phase === 'idle' && action.elsewhere ? (
                <Text testID={`ip-waiting-elsewhere-${item.requestId}`} style={styles.secondary}>
                    {t('ignorePrevious.waiting.answeringElsewhere')}
                </Text>
            ) : null}
            {questions ? <WaitingQuestion key={JSON.stringify([questions, item.disabledReason])} sessionId={item.sessionId} requestId={item.requestId} questions={questions}
                readOnly={Boolean(item.disabledReason)} disabled={disabled} busy={busy} sent={phase === 'sent'} error={action.phase === 'idle' && action.error ? t('ignorePrevious.waiting.answerFailed') : null}
                onDirtyChange={onDirtyChange} onSend={call => void send('allow', call)} /> : null}
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
    </>;
}
