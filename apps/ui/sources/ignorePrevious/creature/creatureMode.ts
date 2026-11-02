export type CreatureMode = 'rest' | 'working' | 'burst' | 'calm';
export type CreatureCoordinator = 'replying' | 'idle' | 'offline' | 'resuming' | 'none';
export type CreatureModeInput = Readonly<{
    coordinator: CreatureCoordinator;
    waitingCount: number | null;
    requests: readonly Readonly<{ sessionId: string; requestId: string }>[];
    unloadedSessionIds: readonly string[];
    nowMs: number;
    calm?: boolean;
}>;
export type CreatureModeState = Readonly<{
    mode: CreatureMode;
    waitingCount: number | null;
    seenRequestKeys: readonly string[];
    unloadedSessionIds: readonly string[];
    burstUntilMs: number;
}>;
export const CREATURE_BURST_MS = 3000;
/** Include unloaded waits in the count; identities distinguish replacement from hydration.
 * A null count means the initial snapshot has not loaded; its first load is a baseline.
 */
export function advanceCreatureMode(previous: CreatureModeState | null, input: CreatureModeInput): CreatureModeState {
    const seen = new Set(previous?.seenRequestKeys);
    const open = new Set<string>();
    let newRequest = false;
    for (const request of input.requests) {
        const key = JSON.stringify([request.sessionId, request.requestId]);
        if (!seen.has(key) && !previous?.unloadedSessionIds.includes(request.sessionId)) newRequest = true;
        seen.add(key);
        open.add(key);
    }
    const rise = previous?.waitingCount != null && input.waitingCount != null && input.waitingCount > previous.waitingCount;
    const baseline = previous === null || previous.waitingCount === null || input.waitingCount === null;
    const newUnloaded = input.unloadedSessionIds.some(id => !previous?.unloadedSessionIds.includes(id));
    const calm = input.calm === true || !['replying', 'idle'].includes(input.coordinator);
    const burstUntilMs = calm || input.waitingCount === 0 || input.waitingCount === null ? 0
        : !baseline && (newRequest || (rise && newUnloaded)) ? input.nowMs + CREATURE_BURST_MS
        : previous?.burstUntilMs ?? 0;
    const mode = calm ? 'calm' : input.nowMs < burstUntilMs ? 'burst' : input.coordinator === 'replying' ? 'working' : 'rest';
    // Retain history only for open requests or sessions whose request details are unloaded.
    const seenRequestKeys = [...seen].filter(key => {
        if (open.has(key)) return true;
        const [sessionId]: readonly string[] = JSON.parse(key);
        return input.unloadedSessionIds.includes(sessionId);
    });
    return { mode, waitingCount: input.waitingCount, seenRequestKeys, unloadedSessionIds: input.unloadedSessionIds, burstUntilMs };
}
