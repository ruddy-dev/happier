import { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { renderHook, standardCleanup } from '@/dev/testkit';
import { storage } from '@/sync/domains/state/storage';
import type { ScmStatus } from '@/sync/domains/state/storageTypes';

import { useDeskBranches } from './useDeskBranches';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

/** A clean working tree on `branch`; `modifiedCount` lets a test mimic a dirty-count poll. */
function scm(branch: string | null, modifiedCount = 0): ScmStatus {
    return {
        branch,
        isDirty: modifiedCount > 0,
        modifiedCount,
        untrackedCount: 0,
        includedCount: 0,
        lastUpdatedAt: 1,
        includedLinesAdded: 0,
        includedLinesRemoved: 0,
        pendingLinesAdded: 0,
        pendingLinesRemoved: 0,
        linesAdded: 0,
        linesRemoved: 0,
        linesChanged: 0,
    };
}

// Stable across renders, as WorkColumn's memoised ids are.
const IDS = ['w1'] as const;

async function renderBranches() {
    let renders = 0;
    const hook = await renderHook(() => {
        renders += 1;
        return useDeskBranches(IDS);
    });
    return { hook, renders: () => renders };
}

describe('useDeskBranches', () => {
    let previous: ReturnType<typeof storage.getState>;
    beforeEach(() => {
        previous = storage.getState();
    });
    afterEach(() => {
        standardCleanup();
        storage.setState(previous, true);
    });

    it('branch follows a listed session status', async () => {
        const { hook } = await renderBranches();
        expect(hook.getCurrent()).toEqual({ w1: null });
        await act(async () => {
            storage.getState().applyScmStatus('w1', scm('atr-6-x'));
        });
        expect(hook.getCurrent()).toEqual({ w1: 'atr-6-x' });
    });

    it('an unrelated session status leaves identity and render count alone', async () => {
        await act(async () => {
            storage.getState().applyScmStatus('w1', scm('atr-6-x'));
        });
        const { hook, renders } = await renderBranches();
        const before = hook.getCurrent();
        const count = renders();
        await act(async () => {
            storage.getState().applyScmStatus('other', scm('atr-9-x'));
            // A dirty-count poll on the listed session moves no branch either.
            storage.getState().applyScmStatus('w1', scm('atr-6-x', 3));
        });
        expect(hook.getCurrent()).toBe(before);
        expect(renders()).toBe(count);
    });

    it('must not return a status for an unlisted session', async () => {
        const { hook } = await renderBranches();
        await act(async () => {
            storage.getState().applyScmStatus('other', scm('atr-9-x'));
        });
        expect(Object.keys(hook.getCurrent())).toEqual(['w1']);
    });
});
