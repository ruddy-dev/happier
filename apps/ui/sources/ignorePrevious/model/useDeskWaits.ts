import * as React from 'react';
import { shallow } from 'zustand/shallow';
import { listPendingRequestListsFromSession, type SessionPendingRequest } from '@/sync/domains/session/pending/listPendingSessionRequests';
import { buildStableJsonSignature } from '@/sync/domains/session/metadata/sessionMetadataStability';

import type { SessionListRenderableSession } from '@/sync/domains/session/listing/sessionListRenderable';
import type { Message } from '@/sync/domains/messages/messageTypes';
import { readStoredSessionMessagesFromStateLike } from '@/sync/domains/messages/readStoredSessionMessages';
import { storage } from '@/sync/domains/state/storage';
import type { Session } from '@/sync/domains/state/storageTypes';
import { deriveTranscriptInteraction } from '@/utils/sessions/deriveTranscriptInteraction';
import {
    getSessionName,
    getSessionStatus,
    shouldReadTranscriptForPendingRequests,
} from '@/utils/sessions/sessionUtils';

import { selectDeskSessions } from '../useDeskSessions';
import { toWaitingItems, unloadedWaitKey, waitingItemKey, type WaitingDisabledReason, type WaitingItem } from './waitingItems';

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

type State = ReturnType<typeof storage.getState>;
type WaitInput = Readonly<{ row: SessionListRenderableSession; requests: readonly SessionPendingRequest[] }>;
type UnloadedInput = Readonly<{ row: SessionListRenderableSession; reason: UnloadedWait['reason'] }>;
type SessionWait = { input: WaitInput; unloaded: UnloadedInput | null };
type CachedSessionWait = {
    row: SessionListRenderableSession;
    session: Session | undefined;
    transcriptSignature: string;
    value: SessionWait;
    requestSignature: string;
};

/** Classification stays in the upstream owner; both request kinds share its single transcript fold. */
function collectSessionWait(row: SessionListRenderableSession, session: Session | undefined, transcript: DeskTranscript | undefined): SessionWait {
    const needsTranscript = session !== undefined && shouldReadTranscriptForPendingRequests(session);
    const lists = session ? listPendingRequestListsFromSession(session, transcript?.messages) : null;
    const permissions = lists?.permissionRequests ?? [];
    const seen = new Set(permissions.map((request) => request.id));
    const requests = [...permissions, ...(lists?.userActionRequests ?? []).filter((request) => !seen.has(request.id))];
    const status = getSessionStatus(row).state;
    const fullyRead = session !== undefined && (!needsTranscript || transcript?.isLoaded === true);
    return {
        input: { row, requests },
        unloaded: requests.length === 0 && (status === 'permission_required' || status === 'action_required')
            ? { row, reason: fullyRead ? 'unreadable' : 'notLoaded' } : null,
    };
}

export type DeskWaitsSummary = Readonly<{ count: number; ready: boolean }>;
type NotificationWaits = Readonly<{
    waitIds: readonly string[];
    /** Session ownership lets the pure alert rule recognize placeholders gaining request details. */
    waitSessionIds: Readonly<Record<string, string>>;
    ready: boolean;
}>;
type Projection = {
    summary: DeskWaitsSummary;
    sourceInputs: readonly WaitInput[];
    sourceUnloaded: readonly UnloadedInput[];
    inputs: readonly WaitInput[];
    unloaded: UnloadedInput[];
    details?: DeskWaits;
    previousDetails?: DeskWaits;
    notificationWaits?: NotificationWaits;
};
type WaitSnapshot = {
    inputs: readonly WaitInput[];
    unloaded: UnloadedInput[];
    ready: boolean;
    projections: Map<string | undefined, Projection>;
};
let lastState: State | undefined;
let snapshot: WaitSnapshot | undefined;
let sessionCache = new Map<string, CachedSessionWait>();

/** One classification per changed session for this desk's storage, shared even across modal roots. */
function selectWaitSnapshot(state: State): WaitSnapshot {
    if (lastState === state && snapshot) return snapshot;
    const desk = selectDeskSessions(state);
    const nextCache = new Map<string, CachedSessionWait>();
    const inputs: WaitInput[] = [];
    const unloaded: UnloadedInput[] = [];
    for (const row of desk.list) {
        const session = desk.lookup.get(row.id);
        const needsTranscript = session !== undefined && shouldReadTranscriptForPendingRequests(session);
        const entry = needsTranscript ? state.sessionMessages[row.id] : undefined;
        // Message records may mutate in place. Version and load completion are the freshness contract.
        const signature = `${entry?.isLoaded ? 1 : 0}:${entry?.messagesVersion ?? 0}`;
        let cached = sessionCache.get(row.id);
        if (!cached || cached.row !== row || cached.session !== session || cached.transcriptSignature !== signature) {
            const transcript = entry ? { messages: readStoredSessionMessagesFromStateLike(entry), isLoaded: entry.isLoaded === true } : undefined;
            const value = collectSessionWait(row, session, transcript);
            const requestSignature = buildStableJsonSignature(value.input.requests);
            // Same row and same requests: keep the input so item and detail identities survive.
            // A replaced row gets a new input; the summary still compares equal, so its identity holds.
            if (cached && cached.requestSignature === requestSignature
                && cached.value.input.row === row) {
                value.input = cached.value.input;
            }
            if (cached && shallow(cached.value.unloaded, value.unloaded)) value.unloaded = cached.value.unloaded;
            cached = { row, session, transcriptSignature: signature, value, requestSignature };
        }
        nextCache.set(row.id, cached);
        if (cached.value.input.requests.length > 0) inputs.push(cached.value.input);
        if (cached.value.unloaded) unloaded.push(cached.value.unloaded);
    }
    for (const row of desk.unreadable) {
        const value: UnloadedInput = { row, reason: 'unreadable' };
        const previous = snapshot?.unloaded.find((item) => item.row.id === row.id);
        unloaded.push(previous && shallow(previous, value) ? previous : value);
    }
    sessionCache = nextCache;
    lastState = state;
    if (snapshot && snapshot.ready === desk.ready && shallow(snapshot.inputs, inputs) && shallow(snapshot.unloaded, unloaded)) return snapshot;
    // Keep only currently reachable exclusions, and reuse unchanged projections across writes.
    const projections = new Map(snapshot?.projections);
    for (const id of projections.keys()) {
        if (id !== undefined && !desk.lookup.has(id) && !desk.unreadable.some((row) => row.id === id)) projections.delete(id);
    }
    snapshot = { inputs, unloaded, ready: desk.ready, projections };
    return snapshot;
}

function selectProjection(state: State, excludeSessionId?: string): { snapshot: WaitSnapshot; projection: Projection } {
    const current = selectWaitSnapshot(state);
    let projection = current.projections.get(excludeSessionId);
    if (projection?.sourceInputs === current.inputs && projection.sourceUnloaded === current.unloaded
        && projection.summary.ready === current.ready) return { snapshot: current, projection };
    const inputs = current.inputs.filter((input) => input.row.id !== excludeSessionId);
    const unloaded = current.unloaded.filter((item) => item.row.id !== excludeSessionId);
    if (!projection || projection.summary.ready !== current.ready
        || !shallow(projection.inputs, inputs) || !shallow(projection.unloaded, unloaded)) {
        const count = inputs.reduce((sum, input) => sum + input.requests.length, 0) + unloaded.length;
        const summary = projection?.summary.count === count && projection.summary.ready === current.ready
            ? projection.summary : { count, ready: current.ready };
        projection = { summary, sourceInputs: current.inputs, sourceUnloaded: current.unloaded,
            inputs, unloaded, previousDetails: projection?.details ?? projection?.previousDetails };
        current.projections.set(excludeSessionId, projection);
    }
    projection.sourceInputs = current.inputs;
    projection.sourceUnloaded = current.unloaded;
    return { snapshot: current, projection };
}

function selectDetails(state: State, excludeSessionId?: string): DeskWaits {
    const { projection } = selectProjection(state, excludeSessionId);
    if (!projection.details) {
        const previous = projection.previousDetails;
        const oldItems = new Map(previous?.items.map((item) => [item.key, item]));
        const items = toWaitingItems(projection.inputs.map(({ row, requests }) => ({
            sessionId: row.id,
            sessionTitle: getSessionName(row),
            requests,
            disabledReason: approvalDisabledReason(row),
        }))).map((item) => {
            const old = oldItems.get(item.key);
            return old && shallow(old, item) ? old : item;
        });
        const unloaded = projection.unloaded.map(({ row, reason }) => {
            const item: UnloadedWait = { sessionId: row.id, sessionTitle: getSessionName(row), reason };
            const old = previous?.unloaded.find((value) => value.sessionId === row.id);
            return old && shallow(old, item) ? old : item;
        });
        const next = {
            ...projection.summary,
            items: previous && shallow(previous.items, items) ? previous.items : items,
            unloaded: previous && shallow(previous.unloaded, unloaded) ? previous.unloaded : unloaded,
        };
        projection.details = previous && shallow(previous, next) ? previous : next;
        projection.previousDetails = undefined;
    }
    return projection.details;
}

/** Chrome subscribes only to count/readiness. Equivalent summaries retain their identity. */
export function useDeskWaitsSummary(excludeSessionId?: string): DeskWaitsSummary {
    const selector = React.useMemo(() => {
        let previous: DeskWaitsSummary | undefined;
        return (state: State) => {
            const next = selectProjection(state, excludeSessionId).projection.summary;
            previous = previous && shallow(previous, next) ? previous : next;
            return previous;
        };
    }, [excludeSessionId]);
    return storage(selector);
}

/** Alert identity shares request classification with the drawer, without labels or card details. */
export function selectDeskNotificationWaits(state: State): NotificationWaits {
    const { projection } = selectProjection(state);
    if (!projection.notificationWaits) {
        const waitSessionIds = Object.fromEntries([
            ...projection.inputs.flatMap(({ row, requests }) => requests.map(request => [waitingItemKey(row.id, request.id), row.id] as const)),
            ...projection.unloaded.map(({ row }) => [unloadedWaitKey(row.id), row.id] as const),
        ]);
        projection.notificationWaits = {
            ready: projection.summary.ready,
            waitIds: Object.keys(waitSessionIds).sort(),
            waitSessionIds,
        };
    }
    return projection.notificationWaits;
}

/** Detailed subscriptions belong only to an open drawer or panel. */
export function useDeskWaits(excludeSessionId?: string): DeskWaits {
    return storage(React.useCallback((state: State) => selectDetails(state, excludeSessionId), [excludeSessionId]));
}

/** Read current details on a real user action, without a mounted detail subscription. */
export function readDeskWaits(excludeSessionId?: string): DeskWaits {
    return selectDetails(storage.getState(), excludeSessionId);
}

export function useWaitingCount(): number {
    return useDeskWaitsSummary().count;
}
