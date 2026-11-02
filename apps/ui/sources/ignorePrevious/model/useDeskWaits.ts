import * as React from 'react';
import { useShallow } from 'zustand/react/shallow';

import type { SessionListRenderableSession } from '@/sync/domains/session/listing/sessionListRenderable';
import type { Message } from '@/sync/domains/messages/messageTypes';
import { readStoredSessionMessagesFromStateLike } from '@/sync/domains/messages/readStoredSessionMessages';
import { storage } from '@/sync/domains/state/storage';
import type { Session } from '@/sync/domains/state/storageTypes';
import {
    getSessionName,
    getSessionStatus,
    listPendingPermissionRequests,
    listPendingUserActionRequests,
    shouldReadTranscriptForPendingRequests,
} from '@/utils/sessions/sessionUtils';

import { useDeskSessions } from '../useDeskSessions';
import { toWaitingItems, type WaitingItem } from './waitingItems';

/** A session that says it is waiting on you, but whose requests live in a record or transcript not loaded here. */
export type UnloadedWait = Readonly<{ sessionId: string; sessionTitle: string }>;

export type DeskWaits = Readonly<{ items: WaitingItem[]; unloaded: UnloadedWait[]; count: number; ready: boolean }>;

/**
 * What waits on you, from the desk's sessions. Name and state come from the list row, as in the
 * sidebar; the requests themselves come from the full record and, for a live session, its transcript.
 */
export function collectWaits(
    list: readonly SessionListRenderableSession[],
    lookup: ReadonlyMap<string, Session>,
    readTranscript: (sessionId: string) => readonly Message[] | undefined,
): { items: WaitingItem[]; unloaded: UnloadedWait[] } {
    const input = list.map((row) => {
        const session = lookup.get(row.id);
        // As SessionView does: only a session whose requests live in its transcript gets the messages,
        // so an inactive session keeps the helpers' short-circuit and shows no stale request.
        const messages = session && shouldReadTranscriptForPendingRequests(session) ? readTranscript(row.id) : undefined;
        const permissions = session ? listPendingPermissionRequests(session, messages) : [];
        const seen = new Set(permissions.map((request) => request.id));
        const questions = session ? listPendingUserActionRequests(session, messages).filter((request) => !seen.has(request.id)) : [];
        return { row, sessionId: row.id, sessionTitle: getSessionName(row), requests: [...permissions, ...questions] };
    });
    const unloaded = input
        .filter(({ row, requests }) => {
            if (requests.length > 0) return false;
            const state = getSessionStatus(row).state;
            return state === 'permission_required' || state === 'action_required';
        })
        .map(({ sessionId, sessionTitle }) => ({ sessionId, sessionTitle }));
    return { items: toWaitingItems(input), unloaded };
}

type TranscriptEntry = Readonly<{ isLoaded?: boolean; messagesVersion?: number }> | undefined;

/** Changes whenever the transcript's messages do. `messagesById` is mutated in place, so its identity says nothing. */
function transcriptSignature(entry: TranscriptEntry): string {
    return `${entry?.isLoaded ? 1 : 0}:${entry?.messagesVersion ?? 0}`;
}

function readTranscript(sessionId: string): readonly Message[] | undefined {
    const entry = storage.getState().sessionMessages[sessionId];
    return entry ? readStoredSessionMessagesFromStateLike(entry) : undefined;
}

/**
 * The one owner of what waits on you: the panel, the coordinator's chip and every count read it.
 * A transcript write (a request arriving, or a result answering one) need not replace the Session
 * or its list row, so each listed session's transcript version is a dependency of its own.
 */
export function useDeskWaits(excludeSessionId?: string): DeskWaits {
    const { list: sessions, lookup, ready } = useDeskSessions();
    // The coordinator's walk-through rates workers only; the global panel still includes everyone.
    const list = React.useMemo(
        () => excludeSessionId ? sessions.filter((row) => row.id !== excludeSessionId) : sessions,
        [sessions, excludeSessionId],
    );
    // Stable while the list is, so the selector isn't rebuilt every render.
    const ids = React.useMemo(() => list.map((row) => row.id), [list]);
    const signatures = storage(
        useShallow((state) => Object.fromEntries(ids.map((id) => [id, transcriptSignature(state.sessionMessages[id])]))),
    );
    // `signatures` is read through readTranscript, not by name: it is here so a transcript write recomputes.
    return React.useMemo(() => {
        const { items, unloaded } = collectWaits(list, lookup, readTranscript);
        // A bare waiting row counts too (R24): it is one thing to look at.
        return { items, unloaded, count: items.length + unloaded.length, ready };
    }, [list, lookup, signatures, ready]);
}

/** How many things wait on you across your sessions: the count on the desk's approvals button. */
export function useWaitingCount(): number {
    return useDeskWaits().count;
}
