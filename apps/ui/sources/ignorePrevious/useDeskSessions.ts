import * as React from 'react';

import { isUserFacingSession } from '@/sync/domains/session/listing/isUserFacingSession';
import type { SessionListRenderableSession } from '@/sync/domains/session/listing/sessionListRenderable';
import type { Session } from '@/sync/domains/state/storageTypes';
import { useAllSessionListRenderables, useAllSessions, useIsDataReady } from '@/sync/store/hooks';
import { getSessionStatus } from '@/utils/sessions/sessionUtils';

export type DeskSessions = Readonly<{
    /** The sessions the desk shows: the sidebar's list, without hidden system sessions or archived ones. */
    list: readonly SessionListRenderableSession[];
    /** Full records for the sessions loaded so far, for detail the list doesn't carry (requests, usage, mode). */
    lookup: ReadonlyMap<string, Session>;
    /**
     * False until the app's first sync finishes. Before then an empty list means "not loaded yet",
     * so the desk must not say nothing waits or count zero agents. Read it here, not from useIsDataReady.
     */
    ready: boolean;
    /**
     * Sessions waiting on you whose metadata the app could not read (`metadataUnavailable`). The
     * sidebar drops them, so `list` does too; the desk still owes you a row saying something waits.
     */
    unreadable: readonly SessionListRenderableSession[];
}>;

function isWaitingOnYou(row: SessionListRenderableSession): boolean {
    const state = getSessionStatus(row).state;
    return state === 'permission_required' || state === 'action_required';
}

/**
 * The desk's one source of sessions. On a cold load the sidebar's list arrives first and full
 * records load per session later, so which sessions exist always comes from the list.
 */
export function useDeskSessions(): DeskSessions {
    const renderables = useAllSessionListRenderables();
    const sessions = useAllSessions();
    const ready = useIsDataReady();
    const list = React.useMemo(
        () => renderables.filter((session) => !session.archivedAt && isUserFacingSession(session)),
        [renderables],
    );
    const unreadable = React.useMemo(
        () =>
            renderables.filter(
                (session) =>
                    !session.archivedAt
                    && session.metadataUnavailable === true
                    // Still a hidden system session if its flags survived; the unavailable flag alone isn't the question here.
                    && isUserFacingSession({ ...session, metadataUnavailable: false })
                    && isWaitingOnYou(session),
            ),
        [renderables],
    );
    const lookup = React.useMemo(() => new Map(sessions.map((session) => [session.id, session])), [sessions]);
    return React.useMemo(() => ({ list, lookup, ready, unreadable }), [list, lookup, ready, unreadable]);
}
