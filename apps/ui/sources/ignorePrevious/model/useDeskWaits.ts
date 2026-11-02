import * as React from 'react';
import { useShallow } from 'zustand/react/shallow';

import type { SessionListRenderableSession } from '@/sync/domains/session/listing/sessionListRenderable';
import type { Message } from '@/sync/domains/messages/messageTypes';
import { readStoredSessionMessagesFromStateLike } from '@/sync/domains/messages/readStoredSessionMessages';
import { storage } from '@/sync/domains/state/storage';
import type { Session } from '@/sync/domains/state/storageTypes';
import { deriveTranscriptInteraction } from '@/utils/sessions/deriveTranscriptInteraction';
import {
    getSessionName,
    getSessionStatus,
    listPendingPermissionRequests,
    listPendingUserActionRequests,
    shouldReadTranscriptForPendingRequests,
} from '@/utils/sessions/sessionUtils';

import { useDeskSessions } from '../useDeskSessions';
import { toWaitingItems, type WaitingDisabledReason, type WaitingItem } from './waitingItems';

/**
 * A session that says it is waiting on you, but whose requests the desk can't show. `notLoaded`:
 * its full record, or the transcript its requests live in, hasn't loaded yet. `unreadable`: the desk
 * has everything the app could read of it and found no request there (metadata it can't read, or a
 * pending count with no parsable request).
 */
export type UnloadedWait = Readonly<{ sessionId: string; sessionTitle: string; reason: 'notLoaded' | 'unreadable' }>;

/** What the desk has of a session's transcript: its messages so far, and whether the full load finished. */
export type DeskTranscript = Readonly<{ messages: readonly Message[]; isLoaded: boolean }>;

export type DeskWaits = Readonly<{ items: WaitingItem[]; unloaded: UnloadedWait[]; count: number; ready: boolean }>;

/**
 * Whether you may answer this session's requests, by the same policy as its transcript footer.
 * Only live sessions' requests reach the desk, so activity is not the question here. Fails closed:
 * a refusal with no reason the desk can name reads as "not granted".
 */
function approvalDisabledReason(row: SessionListRenderableSession): WaitingDisabledReason {
    const interaction = deriveTranscriptInteraction({
        kind: 'session',
        accessLevel: row.accessLevel,
        canApprovePermissions: row.canApprovePermissions,
        isSessionActive: true,
    });
    if (interaction.canApprovePermissions) return null;
    return interaction.permissionDisabledReason === 'readOnly' ? 'readOnly' : 'notGranted';
}

/**
 * What waits on you, from the desk's sessions. Name and state come from the list row, as in the
 * sidebar; the requests themselves come from the full record and, for a live session, its transcript.
 */
export function collectWaits(
    list: readonly SessionListRenderableSession[],
    lookup: ReadonlyMap<string, Session>,
    readTranscript: (sessionId: string) => DeskTranscript | undefined,
    unreadable: readonly SessionListRenderableSession[],
): { items: WaitingItem[]; unloaded: UnloadedWait[] } {
    const input = list.map((row) => {
        const session = lookup.get(row.id);
        // As SessionView does: only a session whose requests live in its transcript gets the messages,
        // so an inactive session keeps the helpers' short-circuit and shows no stale request.
        const needsTranscript = session !== undefined && shouldReadTranscriptForPendingRequests(session);
        const transcript = needsTranscript ? readTranscript(row.id) : undefined;
        const messages = transcript?.messages;
        const permissions = session ? listPendingPermissionRequests(session, messages) : [];
        const seen = new Set(permissions.map((request) => request.id));
        const questions = session ? listPendingUserActionRequests(session, messages).filter((request) => !seen.has(request.id)) : [];
        return {
            row,
            sessionId: row.id,
            sessionTitle: getSessionName(row),
            requests: [...permissions, ...questions],
            disabledReason: approvalDisabledReason(row),
            // Everything the app can read of it is here, so an empty request list means unreadable, not unloaded.
            fullyRead: session !== undefined && (!needsTranscript || transcript?.isLoaded === true),
        };
    });
    const unloaded: UnloadedWait[] = input
        .filter(({ row, requests }) => {
            if (requests.length > 0) return false;
            const state = getSessionStatus(row).state;
            return state === 'permission_required' || state === 'action_required';
        })
        .map(({ sessionId, sessionTitle, fullyRead }) => ({
            sessionId,
            sessionTitle,
            reason: fullyRead ? 'unreadable' : 'notLoaded',
        }));
    // Never in `list`, so never counted twice.
    for (const row of unreadable) {
        unloaded.push({ sessionId: row.id, sessionTitle: getSessionName(row), reason: 'unreadable' });
    }
    return { items: toWaitingItems(input), unloaded };
}

type TranscriptEntry = Readonly<{ isLoaded?: boolean; messagesVersion?: number }> | undefined;

/** Changes whenever the transcript's messages do. `messagesById` is mutated in place, so its identity says nothing. */
function transcriptSignature(entry: TranscriptEntry): string {
    return `${entry?.isLoaded ? 1 : 0}:${entry?.messagesVersion ?? 0}`;
}

function readTranscript(sessionId: string): DeskTranscript | undefined {
    const entry = storage.getState().sessionMessages[sessionId];
    return entry ? { messages: readStoredSessionMessagesFromStateLike(entry), isLoaded: entry.isLoaded === true } : undefined;
}

/**
 * The one owner of what waits on you: the panel, the coordinator's chip and every count read it.
 * A transcript write (a request arriving, or a result answering one) need not replace the Session
 * or its list row, so each listed session's transcript version is a dependency of its own.
 */
export function useDeskWaits(excludeSessionId?: string): DeskWaits {
    const { list: sessions, lookup, ready, unreadable: unreadableRows } = useDeskSessions();
    // The coordinator's walk-through rates workers only; the global panel still includes everyone.
    const list = React.useMemo(
        () => excludeSessionId ? sessions.filter((row) => row.id !== excludeSessionId) : sessions,
        [sessions, excludeSessionId],
    );
    const unreadable = React.useMemo(
        () => excludeSessionId ? unreadableRows.filter((row) => row.id !== excludeSessionId) : unreadableRows,
        [unreadableRows, excludeSessionId],
    );
    // Stable while the list is, so the selector isn't rebuilt every render.
    const ids = React.useMemo(() => list.map((row) => row.id), [list]);
    const signatures = storage(
        useShallow((state) => Object.fromEntries(ids.map((id) => [id, transcriptSignature(state.sessionMessages[id])]))),
    );
    // `signatures` is read through readTranscript, not by name: it is here so a transcript write recomputes.
    return React.useMemo(() => {
        const { items, unloaded } = collectWaits(list, lookup, readTranscript, unreadable);
        // A bare waiting row counts too (R24): it is one thing to look at.
        return { items, unloaded, count: items.length + unloaded.length, ready };
    }, [list, lookup, signatures, ready, unreadable]);
}

/** How many things wait on you across your sessions: the count on the desk's approvals button. */
export function useWaitingCount(): number {
    return useDeskWaits().count;
}
