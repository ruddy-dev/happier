import { shallow } from 'zustand/shallow';
import { storage } from '@/sync/domains/state/storage';
import { observePendingSessionRequest } from '@/sync/domains/session/pending/listPendingSessionRequests';
import { canReuseTranscriptRenderableAggregateRequestStates } from '@/sync/domains/messages/transcriptRenderableAggregate';
import { waitingItemGenerationKey, waitingRequestContent, type WaitingItem } from './waitingItems';
import { isUserFacingSession } from '@/sync/domains/session/listing/isUserFacingSession';
import { forgetWaitingAction, setWaitingAction, type WaitingHistory } from './waitingHistory';

type State = ReturnType<typeof storage.getState>;
type Watch = { item: WaitingItem; source?: readonly unknown[] };
const observers = new WeakMap<WaitingHistory, { users: number; stop: () => void }>();

/**
 * The drawer's lifetime, including closed intervals. Only acted-on keys are watched. Transcript
 * request states come from the store's existing aggregate, never a message read or detail build.
 */
export function observeWaitingActions(history: WaitingHistory) {
    let observer = observers.get(history);
    if (!observer) {
        observer = { users: 0, stop: startObserving(history) };
        observers.set(history, observer);
    }
    observer.users++;
    return () => {
        if (--observer.users === 0) { observer.stop(); observers.delete(history); }
    };
}

function startObserving(history: WaitingHistory) {
    const scope = storage.getState().profileScope;
    const watches = new Map<string, Watch>();
    let stopStorage: (() => void) | undefined;

    const observe = (state: State) => {
        if (state.profileScope?.serverId !== scope?.serverId || state.profileScope?.accountId !== scope?.accountId) {
            history.setState({ actions: new Map(), departed: new Set() });
            return;
        }
        if (!state.isDataReady || state.socketStatus !== 'connected') return;
        for (const [key, watch] of watches) {
            const { item } = watch;
            const session = state.sessions[item.sessionId];
            const row = state.sessionListRenderables[item.sessionId];
            // R24: missing/unreadable records are not proof that a request was answered.
            if (!session || !row || row.metadataUnavailable) continue;
            const entry = state.sessionMessages[item.sessionId];
            const aggregate = entry?.renderableAggregate;
            // An explicit empty projection with no conflicting per-ID live request proves a
            // gap, even when retention lost the aggregate or kept an old pending contribution.
            // Missing counts or lost transcript evidence alone do not prove departure.
            if (session.pendingPermissionRequestCount === 0
                && session.pendingUserActionRequestCount === 0
                && !session.agentState?.requests?.[item.requestId]) {
                watch.source = undefined;
                history.setState(current => current.departed.has(key) ? current
                    : { departed: new Set(current.departed).add(key) });
                continue;
            }
            if (!session.agentState && !aggregate) continue;
            if (entry && (!aggregate || !canReuseTranscriptRenderableAggregateRequestStates(aggregate,
                session.agentState?.completedRequests ?? null))) continue;
            const transcriptState = aggregate?.requestStates.get(item.requestId);
            const source = [session.agentState?.requests?.[item.requestId], session.agentState?.completedRequests,
                transcriptState, entry?.isLoaded, session.agentState?.requests !== undefined,
                session.pendingPermissionRequestCount, session.pendingUserActionRequestCount,
                session.active, row.archivedAt, isUserFacingSession(row)];
            if (watch.source && shallow(watch.source, source)) continue;
            watch.source = source;
            const available = session.active && !row.archivedAt && isUserFacingSession(row);
            // Per-ID terminal evidence survives a lagging count. Absence without readable details
            // remains unknown, including a partial transcript or a genuine R24 placeholder.
            const observation = available ? observePendingSessionRequest(session, item.requestId, transcriptState)
                : { status: 'absent' as const };
            const request = available && observation.status === 'pending' ? observation.request : null;
            if (!request) {
                if (available && observation.status === 'absent'
                    && (((session.pendingPermissionRequestCount ?? 0) > 0 || (session.pendingUserActionRequestCount ?? 0) > 0)
                        || (entry?.isLoaded !== true && !session.agentState?.requests))) continue;
                history.setState(current => current.departed.has(key) ? current
                    : { departed: new Set(current.departed).add(key) });
            } else if (history.getState().departed.has(key)
                || waitingRequestContent(request) !== item.requestContent
                || (request.createdAt !== null && item.createdAt !== null && request.createdAt !== item.createdAt)) {
                // Retire feedback only. The shared transport guard still owns the actual call.
                const action = history.getState().actions.get(key);
                if (action?.phase === 'sending' && !action.contentsChanged) {
                    setWaitingAction(history, key, { ...action, contentsChanged: true });
                }
                if (action?.phase !== 'sending' && (action?.phase !== 'changed' || history.getState().departed.has(key))) {
                    forgetWaitingAction(history, key);
                }
            }
        }
    };

    const synchronize = () => {
        const current = history.getState();
        if ([...current.departed].some(key => !current.actions.has(key))) {
            history.setState({ departed: new Set([...current.departed].filter(key => current.actions.has(key))) });
        }
        for (const key of watches.keys()) if (!current.actions.has(key)) watches.delete(key);
        for (const key of current.actions.keys()) {
            if (watches.has(key)) continue;
            const item = current.previous.find(item => waitingItemGenerationKey(item) === key)
                ?? current.answered.find(entry => waitingItemGenerationKey(entry.item) === key)?.item;
            if (item) watches.set(key, { item });
        }
        if (watches.size && !stopStorage) stopStorage = storage.subscribe(observe);
        if (!watches.size && stopStorage) { stopStorage(); stopStorage = undefined; }
        if (watches.size) observe(storage.getState());
    };
    const stopHistory = history.subscribe((next, previous) => {
        if (next.actions !== previous.actions) synchronize();
    });
    synchronize();
    return () => { stopHistory(); stopStorage?.(); watches.clear(); };
}
