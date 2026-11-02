import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getStoredCoordinatorId, setCoordinatorOverride, setStoredCoordinatorId, subscribeStoredCoordinatorId } from './deskPrefs';

describe('coordinator override (in memory, never persisted)', () => {
    beforeEach(() => {
        setCoordinatorOverride(null);
        setStoredCoordinatorId('real-pick');
    });
    afterEach(() => {
        setCoordinatorOverride(null);
        setStoredCoordinatorId(null);
    });

    it('is read before the stored pick, and the stored pick is back once it is cleared', () => {
        setCoordinatorOverride('fx-coord');
        expect(getStoredCoordinatorId()).toBe('fx-coord');

        setCoordinatorOverride(null);
        expect(getStoredCoordinatorId()).toBe('real-pick');
    });

    it('leaves the persisted pick alone, even when the user picks while it is set', () => {
        setCoordinatorOverride('fx-coord');
        setStoredCoordinatorId('fx-w1');
        expect(getStoredCoordinatorId()).toBe('fx-w1');

        setCoordinatorOverride(null);
        expect(getStoredCoordinatorId()).toBe('real-pick');
    });

    it('tells subscribers when it is set and when it is cleared', () => {
        const listener = vi.fn();
        const unsubscribe = subscribeStoredCoordinatorId(listener);
        setCoordinatorOverride('fx-coord');
        setCoordinatorOverride(null);
        unsubscribe();
        expect(listener).toHaveBeenCalledTimes(2);
    });
});
