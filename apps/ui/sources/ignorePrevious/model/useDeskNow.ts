import { useNowMs } from '@/hooks/time/useNowMs';

/**
 * How often the desk re-reads the time. One shared timer at this cadence means a silent worker
 * shows as stale at most this long after the 120 s budget runs out (R4).
 */
export const DESK_TICK_MS = 5_000;

/** The desk's clock: every desk consumer shares one timer, and none runs while the app is hidden. */
export function useDeskNow(): number {
    return useNowMs(DESK_TICK_MS);
}
