import { issueKeyFromBranch, issueKeyFromPath, issueKeyFromTitle } from './issueKey';

export type IssueSources = Readonly<{
    /** The coordinator's `<ID>-<role>` tag from the session's metadata, e.g. `ATR-6-build`. */
    tag: string | null;
    title: string | null;
    branch: string | null;
    path: string | null;
}>;

/**
 * The issue a worker works on. The coordinator's tag says so outright; without one, an id that
 * opens the title, then the git branch, then the worktree folder. A tag that doesn't parse counts
 * as no tag.
 */
export function resolveIssue(src: IssueSources): string | null {
    // The tag contract is `<ID>-<role>`, the same shape as a work branch, so the branch pattern reads it:
    // `ATR-6-build` parses, `ATR-6:builder` doesn't.
    return (
        issueKeyFromBranch(src.tag?.trim() || null)
        ?? issueKeyFromTitle(src.title)
        ?? issueKeyFromBranch(src.branch)
        ?? (src.path ? issueKeyFromPath(src.path) : null)
    );
}
