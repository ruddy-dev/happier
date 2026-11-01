import { useShallow } from 'zustand/react/shallow';

import { storage } from '@/sync/domains/state/storage';

/**
 * The git branch of each listed session, from one store subscription. The selector projects to
 * branch strings before `useShallow` compares, so a dirty-count poll, or a status for a session not
 * in `ids`, re-renders nothing.
 *
 * Pass a referentially stable `ids` (memoised on the list): the selector closes over it, and a new
 * array each render makes a new selector each render.
 */
export function useDeskBranches(ids: readonly string[]): Readonly<Record<string, string | null>> {
    return storage(
        useShallow((state) => Object.fromEntries(ids.map((id) => [id, state.sessionScmStatus[id]?.branch ?? null]))),
    );
}
