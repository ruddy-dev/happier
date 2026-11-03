import * as React from 'react';

import type { DeskSessions } from '../useDeskSessions';
import { resolveSessionIssue } from './resolveIssue';
import { useDeskBranches } from './useDeskBranches';

/**
 * The issue each listed session works on, keyed by session id. The tag lives on the full record,
 * so weaker matches wait until the full metadata has caught up with the list row.
 */
export function useIssueKeys({ list, lookup }: DeskSessions, knownProjectCodes?: ReadonlySet<string>): ReadonlyMap<string, string | null> {
    // Stable while the list is, so the branch selector isn't rebuilt every render.
    const ids = React.useMemo(() => list.map((row) => row.id), [list]);
    const branches = useDeskBranches(ids);
    return React.useMemo(
        () =>
            new Map(
                list.map((row) => [row.id, resolveSessionIssue(row, lookup.get(row.id), branches[row.id] ?? null, knownProjectCodes)]),
            ),
        [list, lookup, branches, knownProjectCodes],
    );
}
