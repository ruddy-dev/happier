import type { DeskPrefValue } from '../deskPrefs';
import type { Bulb } from './bulb';

export type DeskNotifySnapshot = Readonly<{
    waitIds: readonly string[];
    waitSessionIds: Readonly<Record<string, string>>;
    /** Presence means a placeholder or partially read transcript, timed from first observation. */
    loadingSessionSinceMs: Readonly<Record<string, number>>;
    observedAtMs: number;
    workerBulbs: readonly Bulb[];
    ready: boolean;
}>;

export function deskNotifyRule(previous: DeskNotifySnapshot | undefined, current: DeskNotifySnapshot, setting: DeskPrefValue<'deskNotify'>): boolean {
    if (!previous?.ready || !current.ready) return false;
    if (setting === 'every') {
        const seen = new Set(previous.waitIds);
        return current.waitIds.some(id => {
            if (seen.has(id)) return false;
            const since = previous.loadingSessionSinceMs[current.waitSessionIds[id]!];
            // Desk record consumers need not load transcripts. Bound absorption so a session
            // left unopened cannot swallow genuinely new requests forever (ATR-69 fix 2).
            return since === undefined || current.observedAtMs - since > 60_000;
        });
    }
    const blocked = (snapshot: DeskNotifySnapshot) => snapshot.waitIds.length > 0 && !snapshot.workerBulbs.includes('working');
    return !blocked(previous) && blocked(current);
}
