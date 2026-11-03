import * as React from 'react';
import { useStore } from 'zustand';
import { Platform, Pressable, View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { createPermissionActionDispatchGuard } from '@/components/tools/shell/permissions/permissionActionDispatchGuard';
import { resolveWaitingQuestions } from '../model/waitingQuestions';
import { WaitingQuestion } from './WaitingQuestion';
import { DeskText as Text } from '../typography/DeskText';
import { Typography } from '@/constants/Typography';
import { waitingRestrictionLabel } from './waitingRestrictionLabel';
import { useWaitingAppearance } from './waitingAppearance';
import { DESK_FONT_STACK } from '../fonts/deskFont';
import { Modal } from '@/modal';
import { sessionAllowResult, sessionDenyResult } from '@/sync/ops';
import type { SessionPermissionResult } from '@/sync/ops/sessions';
import { storage } from '@/sync/domains/state/storage';
import { useSessionListRenderable, useSocketStatus } from '@/sync/store/hooks';
import { t } from '@/text';
import { useDeskNow } from '../model/useDeskNow';
import { workerLastSignalAt, workerUnheardMinutes } from '../model/workerFreshness';
import { waitingItemGenerationKey, waitingRequestContent, type WaitingItem } from '../model/waitingItems';
import { observePendingSessionRequest } from '@/sync/domains/session/pending/listPendingSessionRequests';
import { canReuseTranscriptRenderableAggregateRequestStates } from '@/sync/domains/messages/transcriptRenderableAggregate';
import { readDeskWaits } from '../model/useDeskWaits';
import { forgetWaitingAction, idleWaitingAction, setWaitingAction, type WaitingHistory } from '../model/waitingHistory';

function StaleRequestNote({ sessionId, requestId, offersApproval }: { sessionId: string; requestId: string; offersApproval: boolean }) {
    const session = useSessionListRenderable(sessionId);
    const now = useDeskNow();
    const { styles } = useWaitingAppearance();
    const unknown = !session || session.active !== true || workerLastSignalAt(session) === null;
    let note: string;
    if (unknown) {
        note = offersApproval ? t('ignorePrevious.waiting.workerUnknown') : t('status.activityUnknown');
    } else {
        const minutes = workerUnheardMinutes(session, now);
        if (minutes === null) return null;
        note = offersApproval ? t('ignorePrevious.connection.staleRequest') : t('ignorePrevious.connection.unheard', { minutes });
    }
    return (
        <Text testID={`ip-waiting-stale-${requestId}`} style={styles.secondary}>
            {note}
        </Text>
    );
}

export function OpenSessionButton({ sessionId, onOpen }: { sessionId: string; onOpen: (sessionId: string) => void }) {
    const { terminal, styles } = useWaitingAppearance();
    return (
        <Pressable accessibilityRole="button" accessibilityLabel={t('ignorePrevious.openSession')} style={styles.button} onPress={() => onOpen(sessionId)}>
            <Text style={styles.buttonText}>{terminal ? `[ ${t('ignorePrevious.openSession')} ]` : t('ignorePrevious.openSession')}</Text>
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
    const { terminal, paint, ink, rule, styles } = useWaitingAppearance();
    const [disclosure, setDisclosure] = React.useState<'unopened' | 'open' | 'closed'>('unopened');
    const content = item.requestContent;
    const restriction = waitingRestrictionLabel(item.disabledReason);
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
            style={{ borderBottomWidth: 1, borderBottomColor: rule }}>
            <Pressable ref={toggleRef} testID={`ip-waiting-toggle-${item.requestId}`} accessibilityRole="button"
                accessibilityLabel={[t(expanded ? 'ignorePrevious.waiting.hideDetails' : 'ignorePrevious.waiting.showDetails', {
                    name: item.sessionTitle, issue: issueKey ?? t('ignorePrevious.noIssue'), summary: item.summary,
                }), restriction].filter(Boolean).join('. ')}
                accessibilityState={{ expanded }} aria-expanded={expanded}
                onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
                onPress={() => {
                    if (expanded) setDisclosure('closed');
                    else { setReviewedContent(content); setBlockedByChange(false); setDisclosure('open'); }
                }}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 52, paddingVertical: 10,
                    paddingHorizontal: 4, backgroundColor: focused ? (terminal ? paint.panel2 : theme.colors.surface.inset) : 'transparent',
                    borderRadius: terminal ? 0 : 6,
                    borderWidth: 1, borderColor: focused ? (terminal ? ink : theme.colors.border.strong) : 'transparent' }}>
                <Text testID={`ip-waiting-cursor-${item.requestId}`} accessible={false}
                    style={{ color: ink, width: 12 }}>{terminal && focused ? '›' : expanded ? '−' : '+'}</Text>
                <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                    <Text numberOfLines={1} style={{ color: ink, fontSize: 13 }}>{item.summary}</Text>
                    {restriction ? <Text style={{ ...styles.secondary, fontSize: 12 }}>{restriction}</Text> : null}
                </View>
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
                    <Text selectable style={{ color: ink, fontSize: 13, ...(terminal ? { fontFamily: DESK_FONT_STACK } : Typography.mono()) }}>
                        {item.detail}
                    </Text>
                </>
            )}
            {item.kind === 'user_action' ? null : <StaleRequestNote sessionId={item.sessionId} requestId={item.requestId}
                offersApproval={!item.disabledReason && !item.requiresInspection} />}
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
    const { terminal, mute, styles } = useWaitingAppearance();
    const content = item.requestContent;
    const mounted = React.useRef(true);
    React.useLayoutEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; };
    }, []);
    // The same literal as PermissionFooter's requestKey: the two surfaces arbitrate one request.
    const requestKey = `${item.sessionId}\u0000${item.requestId}`;
    const generation = waitingItemGenerationKey(item);
    const action = useStore(actions, state => state.actions.get(generation) ?? idleWaitingAction);
    const earlier = useStore(actions, state => [...state.actions.entries()].find(([key, candidate]) => key !== generation
        && (candidate.phase === 'sending' || candidate.phase === 'changed') && candidate.requestKey === item.key)?.[1]);
    const { phase } = action;
    const busy = phase === 'sending' || earlier?.phase === 'sending';
    const changedAnswer = earlier?.phase === 'changed' ? earlier : action.phase === 'changed' ? action : null;
    const { status } = useSocketStatus();
    const disconnected = status !== 'connected';
    const disabled = disconnected || refreshing || phase !== 'idle' || !!earlier || !!item.requiresInspection || !expanded;
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
        if (!current || current.disabledReason || current.requiresInspection) return;
        if ([...actions.getState().actions.entries()].some(([key, candidate]) => key !== generation
            && (candidate.phase === 'sending' || candidate.phase === 'changed') && candidate.requestKey === item.key)) return;
        if (current.requestContent !== content || (current.createdAt !== null && item.createdAt !== null && current.createdAt !== item.createdAt)) {
            onRequestChanged();
            return;
        }
        const sending = { phase: 'sending', requestKey: item.key, attempt: {} } as const;
        const ownsAttempt = () => {
            const current = actions.getState().actions.get(generation);
            return current?.phase === 'sending' && current.attempt === sending.attempt;
        };
        const contentsChanged = () => {
            const action = actions.getState().actions.get(generation);
            if (action?.phase === 'sending' && action.contentsChanged) return true;
            const state = storage.getState();
            const session = state.sessions[item.sessionId];
            if (!session) return false;
            const aggregate = state.sessionMessages[item.sessionId]?.renderableAggregate;
            const transcriptState = aggregate && canReuseTranscriptRenderableAggregateRequestStates(aggregate, session.agentState?.completedRequests ?? null)
                ? aggregate.requestStates.get(item.requestId) : undefined;
            const observation = observePendingSessionRequest(session, item.requestId, transcriptState);
            if (observation.status !== 'pending') return false;
            const current = observation.request;
            return waitingRequestContent(current) !== content || (current.createdAt !== null && item.createdAt !== null && current.createdAt !== item.createdAt);
        };
        // History owns occurrence feedback. A fresh dispatch guard lets a surviving card answer
        // a later occurrence, while the shared registry still locks any actual in-flight call.
        const guard = createPermissionActionDispatchGuard(requestKey, { holdAfterSuccess: false });
        try {
            // The guard runs the action only when this press wins the request. A press refused
            // while this card is answering changes nothing; one refused because another screen
            // holds the request says so, and the buttons stay on for when that screen lets go.
            const sent = await guard.dispatch(requestKey, async () => {
                setWaitingAction(actions, generation, sending);
                const result = await call();
                if (result && !result.ok) throw result;
            });
            if (sent && ownsAttempt()) {
                if (contentsChanged()) {
                    setWaitingAction(actions, generation, { phase: 'changed', requestKey: item.key, result: 'sent' });
                } else {
                    const outcome = kind === 'allow' ? 'allowed' : 'denied';
                    setWaitingAction(actions, generation, { phase: 'sent', outcome });
                }
            } else if (!sent && mounted.current && (actions.getState().actions.get(generation) ?? idleWaitingAction).phase === 'idle') {
                setWaitingAction(actions, generation, { phase: 'idle', elsewhere: true });
            }
        } catch (error) {
            // This completion belongs to the reviewed version, even if the row now shows another.
            if (!ownsAttempt()) return;
            if (contentsChanged()) {
                setWaitingAction(actions, generation, { phase: 'changed', requestKey: item.key, result: 'unconfirmed' });
                return;
            }
            if (actions.getState().departed.has(generation)) {
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
            style={[styles.button, disabled && !terminal ? { opacity: 0.5 } : null]}
            // Not awaited: the press returns at once and the guard owns the in-flight answer.
            onPress={() => void send(kind, call)}
        >
            <Text style={[styles.buttonText, disabled && terminal ? { color: mute } : null]}>{terminal ? `[ ${label} ]` : label}</Text>
        </Pressable>
    );

    return <>
            {earlier || phase === 'changed' || (action.phase === 'sending' && action.contentsChanged) ? <Text testID={`ip-waiting-earlier-${item.requestId}`} accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.secondary}>
                {t(earlier?.phase === 'sending' || phase === 'sending' ? 'ignorePrevious.waiting.earlierSending'
                    : changedAnswer?.result === 'unconfirmed' ? 'ignorePrevious.waiting.earlierFailed' : 'ignorePrevious.waiting.earlierUnconfirmed')}
            </Text> : null}
            {item.requiresInspection ? <Text testID={`ip-waiting-inspect-${item.requestId}`} style={styles.secondary}>{t('ignorePrevious.waiting.inspectRequest')}</Text> : null}
            {phase === 'unavailable' ? <Text style={styles.secondary}>{t('ignorePrevious.waiting.alreadyAnswered')}</Text> : null}
            {action.phase === 'idle' && action.elsewhere ? (
                <Text testID={`ip-waiting-elsewhere-${item.requestId}`} style={styles.secondary}>
                    {t('ignorePrevious.waiting.answeringElsewhere')}
                </Text>
            ) : null}
            {questions ? <WaitingQuestion key={JSON.stringify([questions, item.disabledReason])} sessionId={item.sessionId} requestId={item.requestId} questions={questions}
                readOnly={Boolean(item.disabledReason || item.requiresInspection || earlier || phase === 'changed')} disabled={disabled} busy={busy} sent={phase === 'sent'} error={action.phase === 'idle' && action.error ? t('ignorePrevious.waiting.answerFailed') : null}
                onDirtyChange={onDirtyChange} onSend={call => void send('allow', call)} /> : null}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {item.kind === 'user_action' || item.disabledReason || item.requiresInspection ? null : (
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
