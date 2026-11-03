import { createStore } from 'zustand/vanilla';
import { waitingItemGenerationKey, type WaitingItem } from './waitingItems';

export type WaitingOutcome = 'allowed' | 'denied' | 'unavailable';
export type WaitingAction =
    | Readonly<{ phase: 'idle'; elsewhere?: boolean; error?: boolean }>
    | Readonly<{ phase: 'sending' }>
    | Readonly<{ phase: 'sent'; outcome: 'allowed' | 'denied' }>
    | Readonly<{ phase: 'unavailable'; outcome: 'unavailable' }>;

export const idleWaitingAction: WaitingAction = { phase: 'idle' };

type AnsweredItem = { item: WaitingItem; outcome: 'allowed' | 'denied' | 'elsewhere' | 'noLongerWaiting'; remoteOutcome?: 'allowed' | 'denied' };
type WaitingHistoryState = {
    previous: WaitingItem[];
    answered: AnsweredItem[];
    actions: ReadonlyMap<string, WaitingAction>;
    /** Authoritatively absent requests may still receive their in-flight answer. */
    departed: ReadonlySet<string>;
};

/** Owned by one desk/account scope, never persisted or shared across desks. Keys include raw content. */
export function createWaitingHistory() {
    return createStore<WaitingHistoryState>(() => ({ previous: [], answered: [], actions: new Map(), departed: new Set() }));
}
export type WaitingHistory = ReturnType<typeof createWaitingHistory>;

export function setWaitingAction(history: WaitingHistory, key: string, action: WaitingAction) {
    const outcome = waitingActionOutcome(action);
    history.setState(current => ({
        actions: new Map(current.actions).set(key, action),
        answered: outcome && current.answered.some(entry => waitingItemGenerationKey(entry.item) === key)
            ? current.answered.map(entry => waitingItemGenerationKey(entry.item) === key
            ? { ...entry, outcome: outcome === 'unavailable' ? 'noLongerWaiting' : outcome, remoteOutcome: undefined } : entry) : current.answered,
    }));
}

export function forgetWaitingAction(history: WaitingHistory, key: string) {
    history.setState(current => {
        if (!current.actions.has(key)) return current;
        const actions = new Map(current.actions);
        actions.delete(key);
        const departed = new Set(current.departed);
        departed.delete(key);
        return { actions, departed };
    });
}

export function waitingActionOutcome(action: WaitingAction | undefined): WaitingOutcome | undefined {
    return action && 'outcome' in action ? action.outcome : undefined;
}
