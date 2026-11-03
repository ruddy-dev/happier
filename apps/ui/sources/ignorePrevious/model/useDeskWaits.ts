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
export function approvalDisabledReason(row: SessionListRenderableSession): WaitingDisabledReason {
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
type SessionWait = { input: WaitInput; unloaded: UnloadedInput | null; stillLoading: boolean };
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
        stillLoading: !fullyRead,
        unloaded: requests.length === 0 && (status === 'permission_required' || status === 'action_required')
            ? { row, reason: fullyRead ? 'unreadable' : 'notLoaded' } : null,
    };
}

export type DeskWaitsSummary = Readonly<{ count: number; ready: boolean }>;
/** A string retains the existing exclusion scope; an object selects only that session. */
export type DeskWaitsSummaryScope = string | Readonly<{ onlySessionId: string }>;
type NotificationWaits = Readonly<{
    waitIds: readonly string[];
    /** Session ownership lets the pure alert rule recognize placeholders gaining request details. */
    waitSessionIds: Readonly<Record<string, string>>;
    loadingSessionIds: readonly string[];
    ready: boolean;
}>;
type Projection = {
    summary: DeskWaitsSummary;
    sourceInputs: readonly WaitInput[];
    sourceUnloaded: readonly UnloadedInput[];
    sourceLoading: readonly string[];
    inputs: readonly WaitInput[];
    unloaded: UnloadedInput[];
    loadingSessionIds: readonly string[];
    details?: DeskWaits;
    previousDetails?: DeskWaits;
    activity?: DeskWaitsActivity;
    previousActivity?: DeskWaitsActivity;
    notificationWaits?: NotificationWaits;
};
type WaitSnapshot = {
    inputs: readonly WaitInput[];
    unloaded: UnloadedInput[];
    loadingSessionIds: readonly string[];
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
    const loadingSessionIds: string[] = [];
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
        if (cached.value.unloaded || (cached.value.input.requests.length > 0 && cached.value.stillLoading)) loadingSessionIds.push(row.id);
    }
    for (const row of desk.unreadable) {
        const value: UnloadedInput = { row, reason: 'unreadable' };
        const previous = snapshot?.unloaded.find((item) => item.row.id === row.id);
        unloaded.push(previous && shallow(previous, value) ? previous : value);
        loadingSessionIds.push(row.id);
    }
    sessionCache = nextCache;
    lastState = state;
    if (snapshot && snapshot.ready === desk.ready && shallow(snapshot.inputs, inputs) && shallow(snapshot.unloaded, unloaded)
        && shallow(snapshot.loadingSessionIds, loadingSessionIds)) return snapshot;
    // Keep only currently reachable scopes, and reuse unchanged projections across writes.
    const projections = new Map(snapshot?.projections);
    for (const key of projections.keys()) {
        // Keys prefix the session id with its scope, so inclusion and exclusion never share a projection.
        const id = key?.slice(key.indexOf(':') + 1);
        if (id !== undefined && !desk.lookup.has(id) && !desk.unreadable.some((row) => row.id === id)) projections.delete(key);
    }
    snapshot = { inputs, unloaded, loadingSessionIds, ready: desk.ready, projections };
    return snapshot;
}

function selectProjection(state: State, scope?: DeskWaitsSummaryScope): { snapshot: WaitSnapshot; projection: Projection } {
    const current = selectWaitSnapshot(state);
    const onlySessionId = typeof scope === 'object' ? scope.onlySessionId : undefined;
    const selected = onlySessionId === undefined ? undefined : sessionCache.get(onlySessionId)?.value;
    // Global waits retain their placeholder counts. A session-only count is exact only once
    // that session and its request sources are loaded and no unreadable wait remains.
    const ready = current.ready && (onlySessionId === undefined
        || (selected !== undefined && !selected.stillLoading && selected.unloaded === null));
    const key = typeof scope === 'string' ? `exclude:${scope}` : scope ? `only:${scope.onlySessionId}` : undefined;
    let projection = current.projections.get(key);
    if (projection?.sourceInputs === current.inputs && projection.sourceUnloaded === current.unloaded
        && projection.sourceLoading === current.loadingSessionIds
        && projection.summary.ready === ready) return { snapshot: current, projection };
    const inScope = (id: string) => onlySessionId === undefined ? id !== scope : id === onlySessionId;
    const inputs = current.inputs.filter((input) => inScope(input.row.id));
    const unloaded = current.unloaded.filter((item) => inScope(item.row.id));
    const loadingSessionIds = current.loadingSessionIds.filter((id) => inScope(id));
    if (!projection || projection.summary.ready !== ready
        || !shallow(projection.inputs, inputs) || !shallow(projection.unloaded, unloaded)
        || !shallow(projection.loadingSessionIds, loadingSessionIds)) {
        const count = inputs.reduce((sum, input) => sum + input.requests.length, 0) + unloaded.length;
        const summary = projection?.summary.count === count && projection.summary.ready === ready
            ? projection.summary : { count, ready };
        projection = { summary, sourceInputs: current.inputs, sourceUnloaded: current.unloaded, sourceLoading: current.loadingSessionIds,
            inputs, unloaded, loadingSessionIds, previousDetails: projection?.details ?? projection?.previousDetails,
            previousActivity: projection?.activity ?? projection?.previousActivity };
        current.projections.set(key, projection);
    }
    projection.sourceInputs = current.inputs;
    projection.sourceUnloaded = current.unloaded;
    projection.sourceLoading = current.loadingSessionIds;
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
export function useDeskWaitsSummary(scope?: DeskWaitsSummaryScope): DeskWaitsSummary {
    const excludeSessionId = typeof scope === 'string' ? scope : undefined;
    const onlySessionId = typeof scope === 'object' ? scope.onlySessionId : undefined;
    const selector = React.useMemo(() => {
        let previous: DeskWaitsSummary | undefined;
        const selectedScope = onlySessionId === undefined ? excludeSessionId : { onlySessionId };
        return (state: State) => {
            const next = selectProjection(state, selectedScope).projection.summary;
            previous = previous && shallow(previous, next) ? previous : next;
            return previous;
        };
    }, [excludeSessionId, onlySessionId]);
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
            loadingSessionIds: projection.loadingSessionIds,
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


export type DeskWaitsActivity = Readonly<{
    count: number | null;
    requests: readonly Readonly<{ sessionId: string; requestId: string }>[];
    unloadedSessionIds: readonly string[];
}>;
/** Request identities for the header's event animation, without drawer labels or action models. */
function selectActivity(state: State, scope?: DeskWaitsSummaryScope): DeskWaitsActivity {
    const { projection } = selectProjection(state, scope);
    if (!projection.activity) {
        const count = projection.summary.ready ? projection.summary.count : null;
        const requests = projection.inputs.flatMap(({ row, requests }) => requests.map(request => ({
            sessionId: row.id, requestId: request.id,
        })));
        const unloadedSessionIds = projection.unloaded.map(({ row }) => row.id);
        const previous = projection.previousActivity;
        projection.activity = previous && previous.count === count
            && shallow(previous.unloadedSessionIds, unloadedSessionIds)
            && previous.requests.length === requests.length
            && previous.requests.every((request, index) => shallow(request, requests[index]))
            ? previous : { count, requests, unloadedSessionIds };
        projection.previousActivity = undefined;
    }
    return projection.activity;
}

export function useDeskWaitsActivity(scope?: DeskWaitsSummaryScope): DeskWaitsActivity {
    const excludeSessionId = typeof scope === 'string' ? scope : undefined;
    const onlySessionId = typeof scope === 'object' ? scope.onlySessionId : undefined;
    return storage(React.useCallback((state: State) => selectActivity(state,
        onlySessionId === undefined ? excludeSessionId : { onlySessionId }), [excludeSessionId, onlySessionId]));
}
