import { resolveServerIdForSessionIdFromLocalCache } from '@/sync/runtime/orchestration/serverScopedRpc/resolveServerIdForSessionIdFromLocalCache';
import { areServerProfileIdentifiersEquivalent, resolveServerProfileScopeIdForIdentifier } from '@/sync/domains/server/serverProfiles';

type RecordConsumer = { sessionId: string; serverId: string | null };
type RecordConsumerListener = () => void;

// sync subscribes during module evaluation, including through import cycles. Keep both
// registrations and listeners behind a hoisted accessor, without module-level initializers.
function recordConsumers(): { entries: Map<string, Set<RecordConsumer>>; listeners: Set<RecordConsumerListener> } {
    const host = globalThis as typeof globalThis & {
        __HAPPIER_SESSION_RECORD_CONSUMERS__?: { entries: Map<string, Set<RecordConsumer>>; listeners: Set<RecordConsumerListener> };
    };
    return host.__HAPPIER_SESSION_RECORD_CONSUMERS__ ??= { entries: new Map(), listeners: new Set() };
}

function resolveServerId(sessionId: string, serverId?: string | null): string | null {
    const id = serverId?.trim() || resolveServerIdForSessionIdFromLocalCache(sessionId);
    return id ? resolveServerProfileScopeIdForIdentifier(id) || id : null;
}

function notifyChanged(): void {
    for (const listener of recordConsumers().listeners) listener();
}

export function registerSessionRealtimeRecordConsumer(sessionId: string, serverId?: string | null): () => void {
    const id = sessionId.trim();
    if (!id) return () => {};
    const entry = { sessionId: id, serverId: resolveServerId(id, serverId) };
    const entries = recordConsumers().entries;
    let registrations = entries.get(id);
    if (!registrations) entries.set(id, registrations = new Set());
    registrations.add(entry);
    notifyChanged();
    return () => {
        if (entries.get(id)?.delete(entry)) {
            if (registrations.size === 0) entries.delete(id);
            notifyChanged();
        }
    };
}

export function readMountedSessionRealtimeRecordConsumerSessionIds(serverId?: string | null): string[] {
    const sourceServerId = serverId?.trim();
    const ids = new Set<string>();
    for (const [sessionId] of recordConsumers().entries) {
        if (hasSessionRealtimeRecordConsumer(sessionId, sourceServerId)) ids.add(sessionId);
    }
    return [...ids];
}

export function subscribeSessionRealtimeRecordConsumers(listener: RecordConsumerListener): () => void {
    recordConsumers().listeners.add(listener);
    return () => { recordConsumers().listeners.delete(listener); };
}

/** Indexed by session id: socket decisions never allocate a list of all mounted ids. */
export function hasSessionRealtimeRecordConsumer(sessionId: string, serverId?: string | null): boolean {
    const registrations = recordConsumers().entries.get(sessionId);
    if (!registrations) return false;
    const sourceServerId = serverId?.trim();
    for (const entry of registrations) {
        entry.serverId ??= resolveServerId(entry.sessionId);
        if (!sourceServerId || (entry.serverId && areServerProfileIdentifiersEquivalent(entry.serverId, sourceServerId))) return true;
    }
    return false;
}

/** Test isolation, matching the transcript registry: leave subscribers installed. */
export function clearMountedSessionRealtimeRecordConsumers(): void {
    recordConsumers().entries.clear();
}
