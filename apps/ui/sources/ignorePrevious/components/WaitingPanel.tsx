import * as React from 'react';
import { Platform, View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';

import { DeskText as Text } from '../typography/DeskText';
import { useDeskSessionNavigation } from '../useDeskSessionNavigation';
import { useSocketStatus } from '@/sync/store/hooks';
import { storage } from '@/sync/domains/state/storage';
import { t } from '@/text';

import { useCoordinatorId } from '../model/useCoordinatorId';
import { useDeskWaits } from '../model/useDeskWaits';
import { useIssueKeys } from '../model/useIssueKeys';
import { useDeskSessions } from '../useDeskSessions';
import { unloadedWaitKey, type WaitingItem } from '../model/waitingItems';
import { WaitingCard, cardStyles, OpenSessionButton, type WaitingOutcome } from './WaitingCard';

/**
 * Everything across your sessions that waits on you: commands to allow or deny, questions to
 * answer here when supported or open in their session. The body of the desk's approvals drawer, which carries the title.
 * Approving here is the same call the session's own footer makes. `onOpenSession` runs after it
 * opens a session, so a card holding the panel can get out of the way.
 */
type AnsweredItem = { item: WaitingItem; outcome: 'allowed' | 'denied' | 'elsewhere' | 'noLongerWaiting'; remoteOutcome?: 'allowed' | 'denied' };
export type WaitingHistory = { previous: WaitingItem[]; answered: AnsweredItem[]; local: Map<string, WaitingOutcome> };
export function createWaitingHistory(): WaitingHistory { return { previous: [], answered: [], local: new Map() }; }

/** Keeps each card's callback stable while the panel aggregates dirty cards by request key. */
function WaitingRow({ item, onDirtyChange, onFocusedRemoval, ...props }: Omit<React.ComponentProps<typeof WaitingCard>, 'onDirtyChange' | 'onFocusedRemoval'> & {
    onDirtyChange: (key: string, dirty: boolean) => void;
    onFocusedRemoval: (key: string) => void;
}) {
    const reportDirty = React.useCallback((dirty: boolean) => onDirtyChange(item.key, dirty), [item.key, onDirtyChange]);
    const reportFocusedRemoval = React.useCallback(() => onFocusedRemoval(item.key), [item.key, onFocusedRemoval]);
    React.useEffect(() => () => reportDirty(false), [reportDirty]);
    return <WaitingCard {...props} item={item} onDirtyChange={reportDirty} onFocusedRemoval={reportFocusedRemoval} />;
}

export function WaitingPanel({ onOpenSession, history, onDirtyChange, onFocusFallback }: {
    onOpenSession?: () => void;
    history?: WaitingHistory;
    /** Reports whether any card has an unsent pick or text; clears when the panel unmounts. */
    onDirtyChange?: (dirty: boolean) => void;
    onFocusFallback?: () => void;
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
    // Readiness hides the canonical projection. Retain mounted drafts only while their exact
    // session records remain loaded; a server reset clears those records and must drop old rows.
    const refreshingSessions = storage(state => state.isDataReady ? null : state.sessions);
    const retained = React.useRef({ items, lookup: desk.lookup });
    const visibleItems = ready ? items : retained.current.items.filter(item =>
        refreshingSessions?.[item.sessionId] === retained.current.lookup.get(item.sessionId));
    React.useLayoutEffect(() => {
        retained.current = { items: visibleItems, lookup: ready ? desk.lookup : retained.current.lookup };
    }, [ready, visibleItems, desk.lookup]);
    const panelRef = React.useRef<View>(null);
    const previousOrder = React.useRef<readonly string[]>([]);
    const removedFocusIndex = React.useRef<number | null>(null);
    const reportFocusedRemoval = React.useCallback((key: string) => {
        removedFocusIndex.current = previousOrder.current.indexOf(key);
    }, []);
    React.useLayoutEffect(() => {
        const index = removedFocusIndex.current;
        removedFocusIndex.current = null;
        if (index !== null && Platform.OS === 'web' && typeof HTMLElement !== 'undefined') {
            const toggles = panelRef.current instanceof HTMLElement
                ? panelRef.current.querySelectorAll<HTMLElement>('[data-testid^="ip-waiting-toggle-"]') : [];
            const next = toggles[Math.max(0, Math.min(index, toggles.length - 1))];
            if (next) next.focus(); else onFocusFallback?.();
        }
        previousOrder.current = visibleItems.map(item => item.key);
    });
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
                return { item, outcome: localOutcome === 'unavailable' ? 'noLongerWaiting' : localOutcome ?? (remoteOutcome ? 'elsewhere' : 'noLongerWaiting'),
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
    const navigateToSession = useDeskSessionNavigation();
    const styles = cardStyles(theme);

    const open = React.useCallback((sessionId: string) => {
        void navigateToSession(sessionId);
        onOpenSession?.();
    }, [navigateToSession, onOpenSession]);

    // Before the first sync the desk doesn't know what waits; saying nothing waits would be false.
    if (!ready && visibleItems.length === 0) {
        return (
            <Text testID="ip-waiting-connecting" style={styles.secondary}>
                {t('ignorePrevious.connecting')}
            </Text>
        );
    }

    if (ready && items.length === 0 && unloaded.length === 0 && currentHistory.answered.length === 0) {
        return (
            <Text testID="ip-waiting-empty" style={styles.secondary}>
                {t('ignorePrevious.nothingWaits')}
            </Text>
        );
    }

    return (
        <View ref={panelRef} testID="ip-waiting">
            {!ready ? <Text style={styles.secondary}>{t('ignorePrevious.connecting')}</Text> : null}
            {visibleItems.map((item) => (
                <WaitingRow key={item.key} item={item} settledOutcome={currentHistory.local.get(item.key)} refreshing={!ready} onFocusedRemoval={reportFocusedRemoval} isCoordinator={coordinatorId === item.sessionId} onDirtyChange={reportCardDirty} issueKey={issueKeys.get(item.sessionId) ?? null} onOpen={open} onSettled={(outcome) => {
                    const entry = currentHistory.answered.find((answer) => answer.item.key === item.key);
                    if (entry) { entry.outcome = outcome === 'unavailable' ? 'noLongerWaiting' : outcome; entry.remoteOutcome = undefined; refreshHistory(); }
                    else currentHistory.local.set(item.key, outcome);
                }} />
            ))}
            {unloaded.map((wait) => (
                <View key={unloadedWaitKey(wait.sessionId)} testID={`ip-waiting-unloaded-${wait.sessionId}`} style={styles.card}>
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
