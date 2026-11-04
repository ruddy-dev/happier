import { issueKeyFromBranch, issueKeyFromPath, issueKeyFromTag, issueKeyFromTitle } from './issueKey';
import type { SessionListRenderableSession } from '@/sync/domains/session/listing/sessionListRenderable';
import type { Session } from '@/sync/domains/state/storageTypes';
import { getSessionDisplayTitle } from '@/utils/sessions/sessionUtils';

export type IssueSources = Readonly<{
    /** The coordinator's `<ID>-<role>` tag from the session's metadata, e.g. `ATR-6-build`. */
    tag: string | null;
    title: string | null;
    branch: string | null;
    path: string | null;
}>;

/** `ATR` from `ATR-6`. */
function projectOf(key: string): string {
    return key.slice(0, key.lastIndexOf('-'));
}

/**
 * The issue a worker works on. The coordinator's tag says so outright; without one, an id that
 * opens the title, then the git branch, then the worktree folder. A tag that doesn't parse counts
 * as no tag.
 *
 * Titles are mostly Claude's own summaries, and they open with tokens like `SHA-256` or `UTF-8`
 * that read as ids. So a title id counts only when its project matches the branch's id, or the
 * folder's when the branch names none. With neither, the title id stands alone: a title-only
 * false positive on a worker with no issue branch or folder is accepted.
 */
export function resolveIssue(src: IssueSources, knownProjectCodes?: ReadonlySet<string>): string | null {
    const fromTag = issueKeyFromTag(src.tag, knownProjectCodes);
    if (fromTag) return fromTag;
    const fromBranch = issueKeyFromBranch(src.branch, knownProjectCodes);
    const fromPath = src.path ? issueKeyFromPath(src.path, knownProjectCodes) : null;
    const anchor = fromBranch ?? fromPath;
    const fromTitle = issueKeyFromTitle(src.title, knownProjectCodes);
    if (fromTitle && (!anchor || projectOf(fromTitle) === projectOf(anchor))) return fromTitle;
    return anchor;
}

/** Evidence needed before a missing issue key means that no issue could be resolved. */
export function hasSessionIssueMetadata(row: SessionListRenderableSession, loaded: Session | undefined): boolean {
    return Boolean(loaded?.metadata && loaded.metadataVersion >= row.metadataVersion);
}

/** List rows cannot establish a weaker link until the full record's tag has caught up. */
export function resolveSessionIssue(
    row: SessionListRenderableSession,
    loaded: Session | undefined,
    branch: string | null,
    knownProjectCodes?: ReadonlySet<string>,
): string | null {
    if (!hasSessionIssueMetadata(row, loaded) || !loaded?.metadata) return null;
    const tag = loaded.metadata.tag;
    return resolveIssue({
        tag: typeof tag === 'string' ? tag : null,
        title: getSessionDisplayTitle(row), branch, path: row.metadata?.path ?? null,
    }, knownProjectCodes);
}
