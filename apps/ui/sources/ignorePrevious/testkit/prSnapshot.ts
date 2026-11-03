import type { ScmWorkingSnapshot } from '@/sync/domains/state/storageTypes';

export function prSnapshot(overrides: Partial<ScmWorkingSnapshot> = {}): ScmWorkingSnapshot {
    const provider = { kind: 'github', name: 'GitHub', baseUrl: 'https://github.com', nameWithOwner: 'example/project', remoteName: 'origin' } as const;
    return {
        projectKey: 'machine:/repo',
        fetchedAt: Date.UTC(2026, 0, 1, 12),
        repo: { isRepo: true, rootPath: '/repo' },
        branch: { head: 'feature/pr', upstream: 'origin/main', ahead: 0, behind: 0, detached: false },
        hostingProvider: provider,
        pullRequest: { provider, number: 42, title: 'Example change', url: 'https://github.com/example/project/pull/42', baseBranch: 'main', headBranch: 'feature/pr', state: 'open' },
        hasConflicts: false,
        entries: [],
        totals: { includedFiles: 0, pendingFiles: 0, untrackedFiles: 0, includedAdded: 0, includedRemoved: 0, pendingAdded: 0, pendingRemoved: 0 },
        ...overrides,
    };
}
