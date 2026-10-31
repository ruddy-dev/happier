// Work branches and worktree folders follow the wq convention `<proj>-<n>-<slug>`.
const ISSUE_PREFIX = /^([a-z]{2,5})-(\d+)(?:-|$)/i;
// Worktree folders may also be `<repo>-<proj>-<n>[-suffix]`, e.g. `unclank-hub-59`.
const ISSUE_INSIDE = /(?:^|-)([a-z]{2,5})-(\d+)(?=-|$)/i;

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
