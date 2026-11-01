import * as React from 'react';

import { getSessionDisplayTitle } from '@/utils/sessions/sessionUtils';

import type { DeskSessions } from '../useDeskSessions';
import { resolveIssue } from './resolveIssue';
import { useDeskBranches } from './useDeskBranches';

/** The coordinator writes the tag into the session's metadata after spawn; the schema passes it through untyped. */
function readTag(lookup: DeskSessions['lookup'], id: string): string | null {
    const tag = (lookup.get(id)?.metadata as { tag?: unknown } | undefined)?.tag;
    return typeof tag === 'string' ? tag : null;
}

/**
 * The issue each listed session works on, keyed by session id. The tag lives on the full record,
 * so a session whose record hasn't loaded falls back to its title, branch and folder.
 */
export function useIssueKeys({ list, lookup }: DeskSessions): ReadonlyMap<string, string | null> {
    // Stable while the list is, so the branch selector isn't rebuilt every render.
    const ids = React.useMemo(() => list.map((row) => row.id), [list]);
    const branches = useDeskBranches(ids);
    return React.useMemo(
        () =>
            new Map(
                list.map((row) => [
                    row.id,
                    resolveIssue({
                        tag: readTag(lookup, row.id),
                        // The display title, not getSessionName: its folder-name fallback would outrank the branch.
                        title: getSessionDisplayTitle(row),
                        branch: branches[row.id] ?? null,
                        path: row.metadata?.path ?? null,
                    }),
                ]),
            ),
        [list, lookup, branches],
    );
}
