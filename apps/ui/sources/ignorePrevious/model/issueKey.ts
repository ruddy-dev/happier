// Work branches and worktree folders follow the wq convention `<proj>-<n>-<slug>`.
const ISSUE_PREFIX = /^([a-z]{2,5})-(\d+)(?:-|$)/i;

function match(text: string): string | null {
    const m = ISSUE_PREFIX.exec(text);
    return m ? `${m[1].toUpperCase()}-${m[2]}` : null;
}

export function issueKeyFromBranch(branch: string | null): string | null {
    return branch ? match(branch) : null;
}

export function issueKeyFromPath(path: string): string | null {
    const segments = path.split(/[\\/]/).filter(Boolean);
    for (let i = segments.length - 1; i >= 0; i--) {
        const key = match(segments[i]);
        if (key) return key;
    }
    return null;
}
