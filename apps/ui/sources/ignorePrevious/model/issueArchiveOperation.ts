import * as React from 'react';

// Operation-local only. All desk roots and coordinator writers share this exclusion.
const operations = new Map<string, readonly string[]>();
let targets: ReadonlySet<string> = new Set();
const listeners = new Set<() => void>();

function publish() {
    targets = new Set([...operations.values()].flat());
    for (const listener of listeners) listener();
}

export function isIssueArchiveTarget(id: string): boolean {
    return targets.has(id);
}

export function beginIssueArchive(issueKey: string, sessionIds: readonly string[]): (() => void) | null {
    if (operations.has(issueKey) || sessionIds.some(isIssueArchiveTarget)) return null;
    operations.set(issueKey, sessionIds);
    publish();
    return () => {
        operations.delete(issueKey);
        publish();
    };
}

function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}

export function useIssueArchiveTargets(): ReadonlySet<string> {
    return React.useSyncExternalStore(subscribe, () => targets, () => targets);
}
