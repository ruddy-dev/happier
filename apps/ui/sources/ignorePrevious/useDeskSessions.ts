import { shallow } from 'zustand/shallow';

import { isUserFacingSession } from '@/sync/domains/session/listing/isUserFacingSession';
import type { SessionListRenderableSession } from '@/sync/domains/session/listing/sessionListRenderable';
import type { Session } from '@/sync/domains/state/storageTypes';
import { storage } from '@/sync/domains/state/storage';
import { getSessionStatus } from '@/utils/sessions/sessionUtils';

export type DeskSessions = Readonly<{
    /** The sessions the desk shows: the sidebar's list, without hidden system sessions or archived ones. */
    list: readonly SessionListRenderableSession[];
    /** Archived rows retain issue and PR associations for partial Archive and the later archive view. */
    archived: readonly SessionListRenderableSession[];
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

type DeskSource = Pick<ReturnType<typeof storage.getState>, 'sessions' | 'sessionListRenderables' | 'isDataReady'>;
let previousSource: DeskSource | undefined;
let previousDesk: DeskSessions | undefined;

/**
 * The desk's one source of sessions. On a cold load the sidebar's list arrives first and full
 * records load per session later, so which sessions exist always comes from the list.
 * Shared by React consumers and the waits selector, including modal roots.
 */
export function selectDeskSessions(state: DeskSource): DeskSessions {
    if (previousDesk && previousSource?.sessions === state.sessions
        && previousSource.sessionListRenderables === state.sessionListRenderables
        && previousSource.isDataReady === state.isDataReady) return previousDesk;
    const renderables = state.isDataReady
        ? Object.values(state.sessionListRenderables).sort((a, b) => b.updatedAt - a.updatedAt) : [];
    const list = renderables.filter((session) => !session.archivedAt && isUserFacingSession(session));
    const archived = renderables.filter((session) => Boolean(session.archivedAt) && isUserFacingSession(session));
    const unreadable = renderables.filter((session) => !session.archivedAt
        && session.metadataUnavailable === true
        && isUserFacingSession({ ...session, metadataUnavailable: false })
        && isWaitingOnYou(session));
    const lookup = new Map(state.isDataReady ? Object.values(state.sessions).map((session) => [session.id, session] as const) : []);
    const next = {
        list: previousDesk && shallow(previousDesk.list, list) ? previousDesk.list : list,
        archived: previousDesk && shallow(previousDesk.archived, archived) ? previousDesk.archived : archived,
        unreadable: previousDesk && shallow(previousDesk.unreadable, unreadable) ? previousDesk.unreadable : unreadable,
        lookup: previousDesk && shallow(previousDesk.lookup, lookup) ? previousDesk.lookup : lookup,
        ready: state.isDataReady,
    };
    previousSource = state;
    previousDesk = previousDesk && shallow(previousDesk, next) ? previousDesk : next;
    return previousDesk;
}

export function useDeskSessions(): DeskSessions {
    return storage(selectDeskSessions);
}
