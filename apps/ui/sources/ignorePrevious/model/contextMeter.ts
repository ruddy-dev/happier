export type ContextMeter = Readonly<{
    used: number;
    /** What the bar fills towards: the auto-compact limit when known, else the model window. */
    limit: number;
    towardsCompact: boolean;
    /** 0 to 1. */
    ratio: number;
    windowTokens: number | null;
}>;

/**
 * How full a session's context is. Claude Code compacts at its own `autoCompactWindow`
 * (220k on the author's setup), well before a 1M window fills, so that limit is the one worth watching.
 */
export function contextMeter(input: { used: number; windowTokens: number | null; compactAt: number | null }): ContextMeter | null {
    const { used, windowTokens, compactAt } = input;
    const towardsCompact = compactAt !== null && (windowTokens === null || compactAt < windowTokens);
    const limit = towardsCompact ? compactAt : windowTokens;
    if (limit === null || limit <= 0) return null;
    return { used, limit, towardsCompact, ratio: Math.min(1, Math.max(0, used / limit)), windowTokens };
}
