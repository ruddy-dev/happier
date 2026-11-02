import type { ScmWorkingSnapshot } from '@/sync/domains/state/storageTypes';
import { buildPullRequestUiModel } from '@/components/sessions/sourceControl/pullRequests/pullRequestUiModel';

export type WorkerPrBadge = Readonly<{
    state: 'open' | 'merged' | 'closed';
    numberLabel: string;
    url: string;
    old: boolean;
    fetchedAt: number | null;
}>;

export function buildWorkerPrBadge(snapshot: ScmWorkingSnapshot | null, now: number): WorkerPrBadge | null {
    const model = buildPullRequestUiModel(snapshot);
    // ready_to_create is not proof of absence: the snapshot collapses failed, skipped and
    // successful empty PR lookups to null. Only an existing PR is currently knowable here.
    if (model.kind !== 'existing_pull_request' || model.state === 'unknown') return null;
    const fetchedAt = typeof snapshot?.fetchedAt === 'number' && Number.isFinite(snapshot.fetchedAt)
        ? snapshot.fetchedAt : null;
    return {
        state: model.state,
        numberLabel: model.numberLabel,
        url: model.pullRequest.url,
        fetchedAt,
        old: fetchedAt !== null && now - fetchedAt > 10 * 60_000,
    };
}
