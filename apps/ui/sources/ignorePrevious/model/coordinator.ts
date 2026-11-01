export type CoordinatorCandidate = {
    id: string;
    path: string;
    active: boolean;
    archived: boolean;
    updatedAt: number;
};

/**
 * The session shown in the coordinator pane: the user's stored choice while it still exists,
 * else the newest active session started in the coordinator folder, else none (the desk shows a picker).
 */
export function pickCoordinatorSessionId(
    candidates: readonly CoordinatorCandidate[],
    opts: { storedId: string | null; coordinatorPath: string | null },
): string | null {
    if (opts.storedId && candidates.some((c) => c.id === opts.storedId && !c.archived)) return opts.storedId;
    if (!opts.coordinatorPath) return null;
    let best: CoordinatorCandidate | null = null;
    for (const c of candidates) {
        if (c.archived || !c.active || c.path !== opts.coordinatorPath) continue;
        if (!best || c.updatedAt > best.updatedAt) best = c;
    }
    return best?.id ?? null;
}
