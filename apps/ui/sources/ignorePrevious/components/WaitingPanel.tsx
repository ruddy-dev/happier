import * as React from 'react';
import { View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';

import { Text } from '@/components/ui/text/Text';
import { useNavigateToSession } from '@/hooks/session/useNavigateToSession';
import { useSocketStatus } from '@/sync/store/hooks';
import { t } from '@/text';

import { useCoordinatorId } from '../model/useCoordinatorId';
import { useDeskWaits } from '../model/useDeskWaits';
import { useIssueKeys } from '../model/useIssueKeys';
import { useDeskSessions } from '../useDeskSessions';
import { unloadedWaitKey, type WaitingItem } from '../model/waitingItems';
import { WaitingCard, cardStyles, OpenSessionButton } from './WaitingCard';

/**
 * Everything across your sessions that waits on you: commands to allow or deny, questions to
 * answer here when supported or open in their session. The body of the desk's approvals drawer, which carries the title.
 * Approving here is the same call the session's own footer makes. `onOpenSession` runs after it
 * opens a session, so a card holding the panel can get out of the way.
 */
type AnsweredItem = { item: WaitingItem; outcome: 'allowed' | 'denied' | 'elsewhere' | 'noLongerWaiting'; remoteOutcome?: 'allowed' | 'denied' };
export type WaitingHistory = { previous: WaitingItem[]; answered: AnsweredItem[]; local: Map<string, 'allowed' | 'denied'> };
export function createWaitingHistory(): WaitingHistory { return { previous: [], answered: [], local: new Map() }; }

/** Keeps each card's callback stable while the panel aggregates dirty cards by request key. */
function WaitingRow({ item, onDirtyChange, ...props }: Omit<React.ComponentProps<typeof WaitingCard>, 'onDirtyChange'> & {
    onDirtyChange: (key: string, dirty: boolean) => void;
}) {
    const reportDirty = React.useCallback((dirty: boolean) => onDirtyChange(item.key, dirty), [item.key, onDirtyChange]);
    React.useEffect(() => () => reportDirty(false), [reportDirty]);
    return <WaitingCard {...props} item={item} onDirtyChange={reportDirty} />;
}

export function WaitingPanel({ onOpenSession, history, onDirtyChange }: {
    onOpenSession?: () => void;
    history?: WaitingHistory;
    /** Reports whether any card has an unsent pick or text; clears when the panel unmounts. */
    onDirtyChange?: (dirty: boolean) => void;
} = {}) {
    const [dirtyCards, setDirtyCards] = React.useState<ReadonlySet<string>>(() => new Set());
    const reportCardDirty = React.useCallback((key: string, dirty: boolean) => {
        setDirtyCards(current => {
            if (current.has(key) === dirty) return current;
            const next = new Set(current);
            if (dirty) next.add(key); else next.delete(key);
            return next;
        });
    }, []);
    const hasDirtyCard = dirtyCards.size > 0;
    React.useEffect(() => { onDirtyChange?.(hasDirtyCard); }, [hasDirtyCard, onDirtyChange]);
    React.useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);
    const { items, unloaded, ready } = useDeskWaits();
    const desk = useDeskSessions();
    const issueKeys = useIssueKeys(desk);
    const coordinatorId = useCoordinatorId(desk.list);
    const { status } = useSocketStatus();
    const ownHistory = React.useRef<WaitingHistory | null>(null);
    if (!ownHistory.current) ownHistory.current = createWaitingHistory();
    const currentHistory = history ?? ownHistory.current;
    const [, refreshHistory] = React.useReducer((n: number) => n + 1, 0);
    React.useEffect(() => {
        if (!ready || status !== 'connected') return;
        const currentKeys = new Set(items.map((item) => item.key));
        const availableSessions = new Set(desk.list.filter((row) => desk.lookup.get(row.id)?.active).map((row) => row.id));
        const unreadableSessions = new Set(unloaded.map((row) => row.sessionId));
        const disappeared = currentHistory.previous.filter((item) => !currentKeys.has(item.key)
            && availableSessions.has(item.sessionId) && !unreadableSessions.has(item.sessionId));
        const retained = currentHistory.answered.filter((entry) => !currentKeys.has(entry.item.key));
        if (disappeared.length || retained.length !== currentHistory.answered.length) {
            const entries: AnsweredItem[] = disappeared.map((item) => {
                const completion = desk.lookup.get(item.sessionId)?.agentState?.completedRequests?.[item.requestId];
                const localOutcome = currentHistory.local.get(item.key);
                const remoteOutcome = completion?.status === 'approved' ? 'allowed' : completion?.status === 'denied' ? 'denied' : undefined;
                return { item, outcome: localOutcome ?? (remoteOutcome ? 'elsewhere' : 'noLongerWaiting'),
                    remoteOutcome: localOutcome ? undefined : remoteOutcome };
            });
            // Mockup 12 displays four recent answers; retain only those four for this page session.
            currentHistory.answered = [...entries.reverse(), ...retained.filter((entry) => !disappeared.some((item) => item.key === entry.item.key))].slice(0, 4);
            refreshHistory();
        }
        for (const key of currentHistory.local.keys()) if (!currentKeys.has(key)) currentHistory.local.delete(key);
        currentHistory.previous = items;
    }, [items, unloaded, ready, status, desk.list, desk.lookup, currentHistory]);
    const { theme } = useUnistyles();
    const navigateToSession = useNavigateToSession();
    const styles = cardStyles(theme);

    const open = React.useCallback((sessionId: string) => {
        void navigateToSession(sessionId);
        onOpenSession?.();
    }, [navigateToSession, onOpenSession]);

    // Before the first sync the desk doesn't know what waits; saying nothing waits would be false.
    if (!ready) {
        return (
            <Text testID="ip-waiting-connecting" style={styles.secondary}>
                {t('ignorePrevious.connecting')}
            </Text>
        );
    }

    if (items.length === 0 && unloaded.length === 0 && currentHistory.answered.length === 0) {
        return (
            <Text testID="ip-waiting-empty" style={styles.secondary}>
                {t('ignorePrevious.nothingWaits')}
            </Text>
        );
    }

    return (
        <View testID="ip-waiting" style={{ gap: 12 }}>
            {items.map((item) => (
                <WaitingRow key={item.key} item={item} isCoordinator={coordinatorId === item.sessionId} onDirtyChange={reportCardDirty} issueKey={issueKeys.get(item.sessionId) ?? null} onOpen={open} onAnswered={(outcome) => {
                    const entry = currentHistory.answered.find((answer) => answer.item.key === item.key);
                    if (entry) { entry.outcome = outcome; entry.remoteOutcome = undefined; refreshHistory(); }
                    else currentHistory.local.set(item.key, outcome);
                }} />
            ))}
            {unloaded.map((wait) => (
                <View key={unloadedWaitKey(wait.sessionId)} style={styles.card}>
                    <Text style={styles.title}>{wait.sessionTitle}</Text>
                    <Text style={styles.secondary}>
                        {wait.reason === 'unreadable' ? t('ignorePrevious.waiting.unreadable') : t('ignorePrevious.needsLook')}
                    </Text>
                    <View style={{ flexDirection: 'row' }}>
                        <OpenSessionButton sessionId={wait.sessionId} onOpen={open} />
                    </View>
                </View>
            ))}
            {currentHistory.answered.length ? (
                <View style={{ gap: 6 }}>
                    <Text accessibilityRole="header" style={styles.title}>{t('ignorePrevious.waiting.answered')}</Text>
                    {currentHistory.answered.map(({ item, outcome, remoteOutcome }) => (
                        <View key={item.key} testID={`ip-answered-${item.requestId}`} style={styles.card}>
                            <Text style={styles.title}>{item.sessionTitle}</Text>
                            <Text style={styles.secondary}>{item.summary}</Text>
                            <Text style={styles.secondary}>{t(`ignorePrevious.waiting.${outcome}`)}</Text>
                            {remoteOutcome ? <Text style={styles.secondary}>{t(`ignorePrevious.waiting.${remoteOutcome}`)}</Text> : null}
                        </View>
                    ))}
                </View>
            ) : null}
        </View>
    );
}
