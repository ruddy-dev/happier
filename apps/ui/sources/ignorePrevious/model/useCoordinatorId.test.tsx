import { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { renderHook, standardCleanup } from '@/dev/testkit';
import { createSessionFixture } from '@/dev/testkit/fixtures/sessionFixtures';
import { buildSessionListRenderableFromSession } from '@/sync/domains/session/listing/sessionListRenderable';

import { getStoredCoordinatorId, setStoredCoordinatorId } from '../deskPrefs';
import { useCoordinatorId } from './useCoordinatorId';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function row(id: string, archivedAt?: number) {
    return buildSessionListRenderableFromSession(createSessionFixture({ id, active: true, ...(archivedAt ? { archivedAt } : {}) }));
}

const list = [row('s1'), row('s2')];

async function renderCoordinatorId(rows = list) {
    let renders = 0;
    const hook = await renderHook(() => {
        renders += 1;
        return useCoordinatorId(rows);
    });
    return { hook, renders: () => renders };
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

    it('unsubscribes on unmount', async () => {
        const { hook, renders } = await renderCoordinatorId();
        await hook.unmount();
        const count = renders();
        await act(async () => {
            setStoredCoordinatorId('s2');
        });
        expect(renders()).toBe(count);
    });
});
