import * as React from 'react';
import { useIsFocused } from '@react-navigation/native';

import { useSocketStatus } from '@/sync/store/hooks';

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
    const { status, lastDisconnectedAt } = useSocketStatus();
    const connected = status === 'connected';
    const subscribe = React.useCallback(
        (listener: () => void) => (focused && connected ? subscribeToNowMs(DESK_TICK_MS, listener) : unsubscribed),
        [focused, connected],
    );
    const getSnapshot = React.useCallback(() => readNowMs(DESK_TICK_MS), []);
    const now = React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
    const lastSeenNow = React.useRef(lastDisconnectedAt ?? now);
    React.useEffect(() => {
        if (connected) lastSeenNow.current = now;
    }, [connected, now]);
    // A lost connection is not evidence that each worker died. Keep the last rendered ages
    // until reconnect, when the shared clock immediately judges the current records again.
    return connected ? now : lastSeenNow.current;
}
