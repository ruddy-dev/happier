import type { DeskPrefValue } from '../deskPrefs';
import type { Bulb } from './bulb';

export type DeskNotifySnapshot = Readonly<{
    waitIds: readonly string[];
    workerBulbs: readonly Bulb[];
    ready: boolean;
}>;

export function deskNotifyRule(previous: DeskNotifySnapshot | undefined, current: DeskNotifySnapshot, setting: DeskPrefValue<'deskNotify'>): boolean {
    if (!previous?.ready || !current.ready) return false;
    if (setting === 'every') {
        const seen = new Set(previous.waitIds);
        return current.waitIds.some(id => !seen.has(id));
    }
    const blocked = (snapshot: DeskNotifySnapshot) => snapshot.waitIds.length > 0 && !snapshot.workerBulbs.includes('working');
    return !blocked(previous) && blocked(current);
}
