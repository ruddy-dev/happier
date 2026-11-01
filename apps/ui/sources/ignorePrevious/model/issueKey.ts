// Work branches and worktree folders follow the wq convention `<proj>-<n>-<slug>`.
const ISSUE_PREFIX = /^([a-z]{2,5})-(\d+)(?:-|$)/i;
// Worktree folders may also be `<repo>-<proj>-<n>[-suffix]`, e.g. `unclank-hub-59`.
const ISSUE_INSIDE = /(?:^|-)([a-z]{2,5})-(\d+)(?=-|$)/i;
// Session titles open with the id, maybe in brackets, then a space, colon, comma, slash or a full stop
// that ends a sentence: `ATR-6 build`, `[ATR-6] build`, `ATR-6, build`, `ATR-6/ATR-7 merge` (the first id).
// `ATR-6.5` is a version, not an id.
const ISSUE_TITLE = /^\[?([a-z]{2,5})-(\d+)(?=$|[\s:,/\]-]|\.(?:\s|$))/i;

function match(text: string, pattern: RegExp = ISSUE_PREFIX): string | null {
    const m = pattern.exec(text);
    return m ? `${m[1].toUpperCase()}-${m[2]}` : null;
}

export function issueKeyFromBranch(branch: string | null): string | null {
    return branch ? match(branch) : null;
}

export function issueKeyFromPath(path: string): string | null {
    const segments = path.split(/[\\/]/).filter(Boolean);
    for (let i = segments.length - 1; i >= 0; i--) {
        const key = match(segments[i]) ?? match(segments[i], ISSUE_INSIDE);
        if (key) return key;
    }
    return null;
}

/** The issue id a session title opens with, as in `ATR-6 build`, `ATR-6: build` or `[ATR-6] build`. */
export function issueKeyFromTitle(title: string | null): string | null {
    return title ? match(title.trim(), ISSUE_TITLE) : null;
}
