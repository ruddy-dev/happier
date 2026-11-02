import * as React from 'react';
import { shallow } from 'zustand/shallow';
import { Platform } from 'react-native';

import { storage } from '@/sync/domains/state/storage';
import { t } from '@/text';
import { getSessionStatus } from '@/utils/sessions/sessionUtils';
import { useDeskPref } from '../deskPrefs';
import { selectDeskSessions } from '../useDeskSessions';
import { bulbFromSessionState, type Bulb } from './bulb';
import { readDeskBrowserPermission } from './deskBrowserPermission';
import { deskNotifyRule, type DeskNotifySnapshot } from './deskNotifyRule';
import { selectDeskNotificationWaits } from './useDeskWaits';
import { useDeskNow } from './useDeskNow';

export function useDeskBrowserNotifier(coordinatorId: string | null): void {
    const [setting] = useDeskPref('deskNotify');
    const nowMs = useDeskNow();
    // Retain equivalent snapshots across clock-driven selector replacements as well as store writes.
    const selected = React.useRef<DeskNotifySnapshot | undefined>(undefined);
    const selectSnapshot = React.useMemo(() => {
        let lastList: ReturnType<typeof selectDeskSessions>['list'] | undefined;
        let lastNowMs: number | undefined;
        let workerBulbs: Bulb[] = [];
        return (state: ReturnType<typeof storage.getState>, atMs: number): DeskNotifySnapshot => {
            const desk = selectDeskSessions(state);
            const waits = selectDeskNotificationWaits(state);
            if (lastList !== desk.list || lastNowMs !== atMs) {
                workerBulbs = desk.list.filter(row => row.id !== coordinatorId)
                    .map(row => bulbFromSessionState(getSessionStatus(row, atMs).state));
                lastList = desk.list;
                lastNowMs = atMs;
            }
            const previous = selected.current;
            const observedAtMs = Date.now();
            const loadingSessionSinceMs = Object.fromEntries(waits.loadingSessionIds.map(id => [
                id, previous?.loadingSessionSinceMs[id] ?? observedAtMs,
            ]));
            if (previous && previous.ready === waits.ready
                && shallow(previous.waitIds, waits.waitIds) && shallow(previous.waitSessionIds, waits.waitSessionIds)
                && shallow(previous.loadingSessionSinceMs, loadingSessionSinceMs)
                && shallow(previous.workerBulbs, workerBulbs)) return previous;
            selected.current = { ...waits, loadingSessionSinceMs, observedAtMs, workerBulbs };
            return selected.current;
        };
    }, [coordinatorId]);
    const selector = React.useCallback((state: ReturnType<typeof storage.getState>) => {
        // Hidden store writes must not rewind bulbs to the paused desk clock after a recheck.
        const atMs = typeof document !== 'undefined' && document.visibilityState !== 'visible' ? Date.now() : nowMs;
        return selectSnapshot(state, atMs);
    }, [selectSnapshot, nowMs]);
    const current = storage(selector);
    const previous = React.useRef<DeskNotifySnapshot | undefined>(undefined);

    const evaluate = React.useCallback((next: DeskNotifySnapshot) => {
        const fire = deskNotifyRule(previous.current, next, setting);
        // Advance even when focused or permission is absent: later updates must not replay a wait.
        previous.current = next;
        if (!fire || readDeskBrowserPermission() !== 'granted'
            || typeof document === 'undefined' || typeof window === 'undefined'
            || (document.visibilityState === 'visible' && document.hasFocus())) return;
        try {
            const notification = new globalThis.Notification(t('ignorePrevious.notifications.alertTitle'), { tag: 'ip-waiting' });
            notification.onclick = () => {
                window.focus();
                notification.close();
            };
        } catch {
            // Some browsers expose the API but reject tab-created notifications. Never log work data.
            console.warn('[desk] Browser alert could not be shown.');
        }
    }, [setting]);

    React.useEffect(() => evaluate(current), [current, evaluate]);

    const hasWaits = current.waitIds.length > 0;
    React.useEffect(() => {
        if (Platform.OS !== 'web' || typeof document === 'undefined' || typeof window === 'undefined') return;
        let interval: ReturnType<typeof setInterval> | undefined;
        const update = () => {
            const needsRecheck = setting === 'blocked' && hasWaits && typeof globalThis.Notification === 'function'
                && (document.visibilityState !== 'visible' || !document.hasFocus());
            if (!needsRecheck && interval !== undefined) {
                clearInterval(interval);
                interval = undefined;
            } else if (needsRecheck && interval === undefined) {
                // The visible desk clock pauses while hidden. Browsers may throttle this 30 s
                // recheck; it shares snapshot selection and transition handling with store updates.
                interval = setInterval(() => {
                    update();
                    if (interval !== undefined) evaluate(selectSnapshot(storage.getState(), Date.now()));
                }, 30_000);
            }
        };
        update();
        document.addEventListener('visibilitychange', update);
        window.addEventListener('focus', update);
        window.addEventListener('blur', update);
        return () => {
            if (interval !== undefined) clearInterval(interval);
            document.removeEventListener('visibilitychange', update);
            window.removeEventListener('focus', update);
            window.removeEventListener('blur', update);
        };
    }, [hasWaits, setting, evaluate, selectSnapshot]);
}

export function DeskBrowserNotifier({ coordinatorId }: { coordinatorId: string | null }) {
    useDeskBrowserNotifier(coordinatorId);
    return null;
}
