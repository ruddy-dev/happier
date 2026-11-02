// Branches and folders: hyphenated codes accept 2+ letters in any case; underscore codes
// accept 2–5 letters in any case; compact codes require 2–5 uppercase letters in the input.
const ISSUE_PREFIX = /^([a-zA-Z]{2,}(?=-)|[a-zA-Z]{2,5}(?=_)|[A-Z]{2,5})[-_]?(\d+)(?:-|$)/;
// Spawn tags retain the coordinator's canonical `<ID>-<role>` contract.
const ISSUE_TAG = /^([a-z]{2,})-(\d+)(?:-|$)/i;
// Session titles open with the id, maybe in brackets, then a space, colon, comma, slash or a full stop
// that ends a sentence: `ATR-6 build`, `[ATR-6] build`, `ATR-6, build`, `ATR-6/ATR-7 merge` (the first id).
// `ATR-6.5` is a version, not an id.
const ISSUE_TITLE = /^\[?([a-z]{2,})-(\d+)(?=$|[\s:,/\]-]|\.(?:\s|$))/i;

function match(text: string, pattern: RegExp = ISSUE_PREFIX, knownProjectCodes?: ReadonlySet<string>): string | null {
    const m = pattern.exec(text);
    if (!m || (knownProjectCodes && !knownProjectCodes.has(m[1].toUpperCase()))) return null;
    return `${m[1].toUpperCase()}-${m[2]}`;
}

export function issueKeyFromBranch(branch: string | null, knownProjectCodes?: ReadonlySet<string>): string | null {
    if (!branch) return null;
    for (const segment of branch.split('/')) {
        const key = match(segment, ISSUE_PREFIX, knownProjectCodes);
        if (key) return key;
    }
    return null;
}

/** Spawn tags use `<ID>-<role>`, not a namespaced branch path. */
export function issueKeyFromTag(tag: string | null, knownProjectCodes?: ReadonlySet<string>): string | null {
    return tag ? match(tag.trim(), ISSUE_TAG, knownProjectCodes) : null;
}

export function issueKeyFromPath(path: string, knownProjectCodes?: ReadonlySet<string>): string | null {
    const segments = path.split(/[\\/]/).filter(Boolean);
    for (let i = segments.length - 1; i >= 0; i--) {
        const key = match(segments[i], ISSUE_PREFIX, knownProjectCodes);
        if (key) return key;
        // A folder may contain an unknown prefix before a real project key.
        for (const candidate of segments[i].matchAll(/(?:^|-)([a-z]{2,})-(\d+)(?=-|$)/gi)) {
            const inside = match(candidate[0].replace(/^-/, ''), ISSUE_TAG, knownProjectCodes);
            if (inside) return inside;
        }
    }
    return null;
}

/** The issue id a session title opens with, as in `ATR-6 build`, `ATR-6: build` or `[ATR-6] build`. */
export function issueKeyFromTitle(title: string | null, knownProjectCodes?: ReadonlySet<string>): string | null {
    return title ? match(title.trim(), ISSUE_TITLE, knownProjectCodes) : null;
}
