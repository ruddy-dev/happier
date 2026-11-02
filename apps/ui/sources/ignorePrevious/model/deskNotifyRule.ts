import type { DeskPrefValue } from '../deskPrefs';
import type { Bulb } from './bulb';
import { unloadedWaitKey } from './waitingItems';

export type DeskNotifySnapshot = Readonly<{
    waitIds: readonly string[];
    waitSessionIds: Readonly<Record<string, string>>;
    workerBulbs: readonly Bulb[];
    ready: boolean;
}>;

export function deskNotifyRule(previous: DeskNotifySnapshot | undefined, current: DeskNotifySnapshot, setting: DeskPrefValue<'deskNotify'>): boolean {
    if (!previous?.ready || !current.ready) return false;
    if (setting === 'every') {
        const seen = new Set(previous.waitIds);
        // Loading request details for a waiting session is not a new question.
        return current.waitIds.some(id => !seen.has(id) && !seen.has(unloadedWaitKey(current.waitSessionIds[id]!)));
    }
    const blocked = (snapshot: DeskNotifySnapshot) => snapshot.waitIds.length > 0 && !snapshot.workerBulbs.includes('working');
    return !blocked(previous) && blocked(current);
}
