import * as React from 'react';
import { useIsFocused } from '@react-navigation/native';

import { readNowMs, subscribeToNowMs } from '@/hooks/time/nowMsClockStore';

/**
 * How often the desk re-reads the time. One shared timer at this cadence means a silent worker
 * shows as stale at most this long after the 120 s budget runs out (R4).
 */
export const DESK_TICK_MS = 5_000;

const unsubscribed = () => {};

/**
 * The desk's clock: every desk consumer shares one timer (the app clock store's bucket for this
 * cadence), and none runs while the app is hidden. It also stops while another screen covers the
 * desk, such as a session opened from it; on return the store hands back the current time at once.
 */
export function useDeskNow(): number {
    const focused = useIsFocused();
    const subscribe = React.useCallback(
        (listener: () => void) => (focused ? subscribeToNowMs(DESK_TICK_MS, listener) : unsubscribed),
        [focused],
    );
    const getSnapshot = React.useCallback(() => readNowMs(DESK_TICK_MS), []);
    return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
