import * as React from 'react';
import { shallow } from 'zustand/shallow';

import { storage } from '@/sync/domains/state/storage';
import { t } from '@/text';
import { getSessionStatus } from '@/utils/sessions/sessionUtils';
import { useDeskPref } from '../deskPrefs';
import { selectDeskSessions } from '../useDeskSessions';
import { bulbFromSessionState, type Bulb } from './bulb';
import { readDeskBrowserPermission } from './deskBrowserPermission';
import { deskNotifyRule, type DeskNotifySnapshot } from './deskNotifyRule';
import { selectDeskNotificationWaits } from './useDeskWaits';

export function useDeskBrowserNotifier(coordinatorId: string | null): void {
    const [setting] = useDeskPref('deskNotify');
    const selector = React.useMemo(() => {
        let previous: DeskNotifySnapshot | undefined;
        let lastList: ReturnType<typeof selectDeskSessions>['list'] | undefined;
        let workerBulbs: Bulb[] = [];
        return (state: ReturnType<typeof storage.getState>): DeskNotifySnapshot => {
            const desk = selectDeskSessions(state);
            const waits = selectDeskNotificationWaits(state);
            if (lastList !== desk.list) {
                workerBulbs = desk.list.filter(row => row.id !== coordinatorId)
                    .map(row => bulbFromSessionState(getSessionStatus(row).state));
                lastList = desk.list;
            }
            if (previous && previous.ready === waits.ready
                && shallow(previous.waitIds, waits.waitIds) && shallow(previous.workerBulbs, workerBulbs)) return previous;
            previous = { ...waits, workerBulbs };
            return previous;
        };
    }, [coordinatorId]);
    const current = storage(selector);
    const previous = React.useRef<DeskNotifySnapshot | undefined>(undefined);

    React.useEffect(() => {
        const fire = deskNotifyRule(previous.current, current, setting);
        // Advance even when focused or permission is absent: later updates must not replay a wait.
        previous.current = current;
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
    }, [current, setting]);
}

export function DeskBrowserNotifier({ coordinatorId }: { coordinatorId: string | null }) {
    useDeskBrowserNotifier(coordinatorId);
    return null;
}
