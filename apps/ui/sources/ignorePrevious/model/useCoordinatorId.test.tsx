import { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderHook, standardCleanup } from '@/dev/testkit';
import { createSessionFixture } from '@/dev/testkit/fixtures/sessionFixtures';
import { buildSessionListRenderableFromSession } from '@/sync/domains/session/listing/sessionListRenderable';

import { getStoredCoordinatorId, setStoredCoordinatorId, subscribeStoredCoordinatorId } from '../deskPrefs';
import { useCoordinatorId } from './useCoordinatorId';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function row(id: string, archivedAt?: number) {
    return buildSessionListRenderableFromSession(createSessionFixture({ id, active: true, ...(archivedAt ? { archivedAt } : {}) }));
}

const list = [row('s1'), row('s2')];

async function renderCoordinatorId(rows = list) {
    const hook = await renderHook(() => useCoordinatorId(rows));
    return { hook };
}

describe('useCoordinatorId', () => {
    let previous: string | null;
    beforeEach(() => {
        previous = getStoredCoordinatorId();
        setStoredCoordinatorId('s1');
    });
    afterEach(() => {
        standardCleanup();
        setStoredCoordinatorId(previous);
    });

    it('a pick made through one consumer reaches a second consumer without a reload', async () => {
        const a = await renderCoordinatorId();
        const b = await renderCoordinatorId();
        expect(a.hook.getCurrent()).toBe('s1');
        await act(async () => {
            setStoredCoordinatorId('s2');
        });
        expect(a.hook.getCurrent()).toBe('s2');
        expect(b.hook.getCurrent()).toBe('s2');
    });

    it('must not return an archived stored coordinator', async () => {
        setStoredCoordinatorId('s2');
        // Missing from the list (the desk leaves archived sessions out) or listed as archived.
        const missing = await renderCoordinatorId([row('s1')]);
        const archived = await renderCoordinatorId([row('s1'), row('s2', 5)]);
        expect(missing.hook.getCurrent()).not.toBe('s2');
        expect(archived.hook.getCurrent()).not.toBe('s2');
    });

    it('the unsubscribe it is handed stops further picks reaching the listener', () => {
        // useSyncExternalStore calls this unsubscribe on unmount; an unmounted hook can't show a missed one.
        const listener = vi.fn();
        const unsubscribe = subscribeStoredCoordinatorId(listener);
        setStoredCoordinatorId('s2');
        expect(listener).toHaveBeenCalledTimes(1);
        unsubscribe();
        setStoredCoordinatorId('s1');
        expect(listener).toHaveBeenCalledTimes(1);
    });
});
