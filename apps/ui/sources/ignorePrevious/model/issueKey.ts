// Branches and folders: hyphenated codes accept 2+ letters in any case; underscore codes
// accept 2–5 letters in any case; compact codes require 2–5 uppercase letters in the input.
const ISSUE_PREFIX = /^([a-zA-Z]{2,}(?=-)|[a-zA-Z]{2,5}(?=_)|[A-Z]{2,5})[-_]?(\d+)(?:-|$)/;
// Spawn tags retain the coordinator's canonical `<ID>-<role>` contract.
const ISSUE_TAG = /^([a-z]{2,})-(\d+)(?:-|$)/i;
// Worktree folders may also be `<repo>-<proj>-<n>[-suffix]`, e.g. `unclank-hub-59`.
const ISSUE_INSIDE = /(?:^|-)([a-z]{2,})-(\d+)(?=-|$)/i;
// Session titles open with the id, maybe in brackets, then a space, colon, comma, slash or a full stop
// that ends a sentence: `ATR-6 build`, `[ATR-6] build`, `ATR-6, build`, `ATR-6/ATR-7 merge` (the first id).
// `ATR-6.5` is a version, not an id.
const ISSUE_TITLE = /^\[?([a-z]{2,})-(\d+)(?=$|[\s:,/\]-]|\.(?:\s|$))/i;

function match(text: string, pattern: RegExp = ISSUE_PREFIX): string | null {
    const m = pattern.exec(text);
    return m ? `${m[1].toUpperCase()}-${m[2]}` : null;
}

export function issueKeyFromBranch(branch: string | null): string | null {
    if (!branch) return null;
    for (const segment of branch.split('/')) {
        const key = match(segment);
        if (key) return key;
    }
    return null;
}

/** Spawn tags use `<ID>-<role>`, not a namespaced branch path. */
export function issueKeyFromTag(tag: string | null): string | null {
    return tag ? match(tag.trim(), ISSUE_TAG) : null;
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
