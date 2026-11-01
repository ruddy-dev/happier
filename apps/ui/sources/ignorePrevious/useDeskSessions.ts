import * as React from 'react';

import { isUserFacingSession } from '@/sync/domains/session/listing/isUserFacingSession';
import type { SessionListRenderableSession } from '@/sync/domains/session/listing/sessionListRenderable';
import type { Session } from '@/sync/domains/state/storageTypes';
import { useAllSessionListRenderables, useAllSessions } from '@/sync/store/hooks';

export type DeskSessions = Readonly<{
    /** The sessions the desk shows: the sidebar's list, without hidden system sessions or archived ones. */
    list: readonly SessionListRenderableSession[];
    /** Full records for the sessions loaded so far, for detail the list doesn't carry (requests, usage, mode). */
    lookup: ReadonlyMap<string, Session>;
}>;

/**
 * The desk's one source of sessions. On a cold load the sidebar's list arrives first and full
 * records load per session later, so which sessions exist always comes from the list.
 */
export function useDeskSessions(): DeskSessions {
    const renderables = useAllSessionListRenderables();
    const sessions = useAllSessions();
    const list = React.useMemo(
        () => renderables.filter((session) => !session.archivedAt && isUserFacingSession(session)),
        [renderables],
    );
    const lookup = React.useMemo(() => new Map(sessions.map((session) => [session.id, session])), [sessions]);
    return React.useMemo(() => ({ list, lookup }), [list, lookup]);
}
