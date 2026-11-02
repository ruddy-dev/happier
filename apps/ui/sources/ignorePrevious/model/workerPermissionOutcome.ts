import { create } from 'zustand';
import { parsePermissionIntentAlias, resolveAgentIdFromSessionMetadata } from '@happier-dev/agents';
import type { ApiMessage } from '@/sync/api/types/apiTypes';
import type { Session } from '@/sync/domains/state/storageTypes';
import { getActiveServerSnapshot } from '@/sync/domains/server/serverRuntime';
import { resolveServerProfileScopeIdForIdentifier } from '@/sync/domains/server/serverProfiles';
import { readStoredSessionRawRecord } from '@/sync/runtime/readStoredSessionContent';
import { resolveSessionLiveConsumption } from '@/sync/runtime/sessionLiveConsumption';
import { useActiveServerSnapshot } from '@/hooks/server/useActiveServerSnapshot';
import { storage } from '@/sync/domains/state/storage';

type Outcome = Readonly<{ mode: string; seq: number }>;
const useOutcomes = create<Readonly<Record<string, Outcome>>>(() => ({}));
// Identity belongs to one retained desk lifetime and one published mode. Pending decrypts
// may finish after either changes, including a release followed by a fresh registration.
const observationScopes = new Map<string, { publishedMode: string | null; lastSeq: number }>();

function outcomeKey(sessionId: string, serverId?: string | null): string {
    const id = serverId?.trim() || getActiveServerSnapshot().serverId;
    return JSON.stringify([resolveServerProfileScopeIdForIdentifier(id) || id, sessionId]);
}

export function useWorkerPermissionOutcome(sessionId: string): string | null {
    const { serverId } = useActiveServerSnapshot();
    const key = outcomeKey(sessionId, serverId);
    return useOutcomes(state => state[key]?.mode ?? null);
}

/** Called by the desk's existing record-retention owner, including on record updates. */
export function retainWorkerPermissionOutcome(sessionId: string, serverId?: string | null): void {
    const key = outcomeKey(sessionId, serverId);
    const publishedMode = parsePermissionIntentAlias(storage.getState().sessions[sessionId]?.metadata?.permissionMode ?? '');
    const previous = observationScopes.get(key);
    if (previous?.publishedMode === publishedMode) return;
    observationScopes.set(key, { publishedMode, lastSeq: previous?.lastSeq ?? -Infinity });
    clearOutcome(key);
}

function clearOutcome(key: string): void {
    useOutcomes.setState(state => {
        if (!state[key]) return state;
        const next = { ...state };
        delete next[key];
        return next;
    }, true);
}

/** Desk mount owns this observation, with no persistence or history backfill. */
export function forgetWorkerPermissionOutcome(sessionId: string, serverId?: string | null): void {
    const key = outcomeKey(sessionId, serverId);
    observationScopes.delete(key);
    clearOutcome(key);
}

/** Read only the event envelope already delivered by the user socket, never a transcript loader. */
export async function observeWorkerPermissionOutcome(params: Readonly<{
    session: Session | undefined;
    sourceServerId?: string | null;
    rawMessage: ApiMessage | undefined;
    shouldContinue: () => boolean;
    getSessionEncryption: (id: string) => { decryptRaw: (ciphertext: string) => Promise<unknown> } | null;
}>): Promise<void> {
    const { session, rawMessage, sourceServerId } = params;
    if (!session || rawMessage?.messageRole !== 'event' || resolveAgentIdFromSessionMetadata(session.metadata) !== 'claude') return;
    if (!resolveSessionLiveConsumption(session.id, sourceServerId).isRecordConsumer) return;
    const key = outcomeKey(session.id, sourceServerId);
    const scope = observationScopes.get(key);
    if (!scope) return;
    const encryption = rawMessage.content.t === 'encrypted' ? params.getSessionEncryption(session.id) : null;
    if (rawMessage.content.t === 'encrypted' && !encryption) return;
    const record = await readStoredSessionRawRecord({ content: rawMessage.content,
        decryptEncrypted: encryption ? value => encryption.decryptRaw(value) : undefined });
    // decryptRaw deliberately returns null on decode/decrypt failure. Report the failed
    // observation through the socket catch as well as handling genuine rejections there.
    if (!record) throw new Error('Worker permission observation could not be decoded');
    if (record.role !== 'agent' || record.content.type !== 'event') return;
    const event = record.content.data;
    if (event.type !== 'runtime-config-outcome' || event.provider !== 'claude' || event.status !== 'applied') return;
    // The Claude mode control verifies current-window/already-effective results. Grouped
    // applied changes can omit shared timing when their per-change timings differ.
    // Their effective mode still comes from the verified permission-mode control.
    if (event.timing && event.timing !== 'current_window' && event.timing !== 'skipped_already_effective') return;
    const change = event.changes?.find(value => value.key === 'sessionMode')
        ?? event.changes?.find(value => value.key === 'permissionMode');
    const mode = typeof change?.effective === 'string' && change.reason !== 'delivered_unverified'
        ? parsePermissionIntentAlias(change.effective) : null;
    if (!mode || !Number.isFinite(rawMessage.seq)) return;
    // Decryption can finish after the desk leaves, or out of sequence.
    if (!params.shouldContinue() || !resolveSessionLiveConsumption(session.id, sourceServerId).isRecordConsumer) return;
    if (observationScopes.get(key) !== scope || rawMessage.seq <= scope.lastSeq) return;
    scope.lastSeq = rawMessage.seq;
    useOutcomes.setState(state => ({ ...state, [key]: { mode, seq: rawMessage.seq } }), true);
}
