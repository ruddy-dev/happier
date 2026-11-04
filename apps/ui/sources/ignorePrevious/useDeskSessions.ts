import { shallow } from 'zustand/shallow';

import { isUserFacingSession } from '@/sync/domains/session/listing/isUserFacingSession';
import type { SessionListRenderableSession } from '@/sync/domains/session/listing/sessionListRenderable';
import type { Session } from '@/sync/domains/state/storageTypes';
import { storage } from '@/sync/domains/state/storage';
import { isUiSessionEncryptionModeAllowed, resolveUiClientEncryptionRequirement } from '@/sync/domains/settings/clientEncryptionRequirement';
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

type DeskSource = Pick<ReturnType<typeof storage.getState>, 'sessions' | 'sessionListRenderables' | 'isDataReady' | 'settings'>;
let previousSource: DeskSource | undefined;
let previousDesk: DeskSessions | undefined;
let previousPolicySource: DeskSource | undefined;
let previousRequirement: ReturnType<typeof resolveUiClientEncryptionRequirement> | undefined;
let previousRenderables: DeskSource['sessionListRenderables'] | undefined;

/** Shared policy projection for current and archive consumers. Retain caches in
 * the store, but expose only rows whose mode the existing policy permits. */
export function selectDeskSessionListRenderables(state: DeskSource): DeskSource['sessionListRenderables'] {
    const requirement = resolveUiClientEncryptionRequirement({ syncedSettings: state.settings, localSettings: state.settings });
    if (previousRenderables && previousPolicySource?.sessions === state.sessions
        && previousPolicySource.sessionListRenderables === state.sessionListRenderables
        && previousRequirement === requirement) return previousRenderables;
    const allowed = Object.values(state.sessionListRenderables).filter(row => {
        const session = state.sessions[row.id];
        // Persisted warm rows have no mode. Under require_e2ee they need evidence
        // from a fetched list row or a full record before exposing identity.
        const mode = row.encryptionMode ?? (session ? session.encryptionMode === 'plain' ? 'plain' : 'e2ee' : 'plain');
        return isUiSessionEncryptionModeAllowed({ requirement, mode });
    });
    const next = allowed.length === Object.keys(state.sessionListRenderables).length
        ? state.sessionListRenderables : Object.fromEntries(allowed.map(row => [row.id, row]));
    previousPolicySource = state;
    previousRequirement = requirement;
    previousRenderables = previousRenderables && shallow(previousRenderables, next) ? previousRenderables : next;
    return previousRenderables;
}

/**
 * The desk's one source of sessions. On a cold load the sidebar's list arrives first and full
 * records load per session later, so which sessions exist always comes from the list.
 * Shared by React consumers and the waits selector, including modal roots.
 */
export function selectDeskSessions(state: DeskSource): DeskSessions {
    if (previousDesk && previousSource?.sessions === state.sessions
        && previousSource.sessionListRenderables === state.sessionListRenderables
        && previousSource.settings === state.settings
        && previousSource.isDataReady === state.isDataReady) return previousDesk;
    const renderables = state.isDataReady
        ? Object.values(selectDeskSessionListRenderables(state)).sort((a, b) => b.updatedAt - a.updatedAt) : [];
    const list = renderables.filter((session) => !session.archivedAt && isUserFacingSession(session));
    const unreadable = renderables.filter((session) => !session.archivedAt
        && session.metadataUnavailable === true
        && isUserFacingSession({ ...session, metadataUnavailable: false })
        && isWaitingOnYou(session));
    const requirement = resolveUiClientEncryptionRequirement({ syncedSettings: state.settings, localSettings: state.settings });
    const lookup = new Map(state.isDataReady ? Object.values(state.sessions).filter(session => isUiSessionEncryptionModeAllowed({
        requirement, mode: state.sessionListRenderables[session.id]?.encryptionMode ?? (session.encryptionMode === 'plain' ? 'plain' : 'e2ee'),
    })).map((session) => [session.id, session] as const) : []);
    const next = {
        list: previousDesk && shallow(previousDesk.list, list) ? previousDesk.list : list,
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
