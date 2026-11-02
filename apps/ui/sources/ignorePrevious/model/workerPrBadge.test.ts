import { describe, expect, it } from 'vitest';
import { buildPullRequestUiModel } from '@/components/sessions/sourceControl/pullRequests/pullRequestUiModel';
import { prSnapshot } from '../testkit/prSnapshot';
import { buildWorkerPrBadge } from './workerPrBadge';

const now = Date.UTC(2026, 0, 1, 12);

describe('worker PR badge', () => {
    it.each(['open', 'merged', 'closed'] as const)('M4: existing_pull_request renders %s with the canonical number and URL', (state) => {
        const snapshot = prSnapshot();
        snapshot.pullRequest = { ...snapshot.pullRequest!, state };
        expect(buildWorkerPrBadge(snapshot, now)).toMatchObject({ state, numberLabel: '#42', url: snapshot.pullRequest.url, old: false });
    });

    it.each([
        ['not_repository', prSnapshot({ repo: { isRepo: false, rootPath: null } })],
        ['unknown_provider', prSnapshot({ hostingProvider: null })],
        ['no_branch', prSnapshot({ branch: { head: null, upstream: null, ahead: 0, behind: 0, detached: false } })],
        ['detached_head', prSnapshot({ branch: { head: null, upstream: null, ahead: 0, behind: 0, detached: true } })],
        ['ready_to_create', prSnapshot({ pullRequest: null })],
    ] as const)('M5/M8: %s gives no badge, including ready_to_create without lookup proof', (kind, snapshot) => {
        expect(buildPullRequestUiModel(snapshot).kind).toBe(kind);
        expect(buildWorkerPrBadge(snapshot, now)).toBeNull();
    });

    it('M8: absent or SCM-disabled snapshots give no badge', () => {
        expect(buildWorkerPrBadge(null, now)).toBeNull();
    });

    it('M5: an existing PR with unknown state gives no badge', () => {
        const snapshot = prSnapshot();
        snapshot.pullRequest = { ...snapshot.pullRequest!, state: 'unknown' };
        expect(buildWorkerPrBadge(snapshot, now)).toBeNull();
    });

    it('M4: stays fresh through ten minutes, then becomes old without losing the PR', () => {
        const snapshot = prSnapshot();
        expect(buildWorkerPrBadge(snapshot, now + 600_000)?.old).toBe(false);
        expect(buildWorkerPrBadge(snapshot, now + 600_001)).toMatchObject({ old: true, fetchedAt: now, state: 'open' });
    });

    it('M4: a missing fetch time retains the badge without inventing an age', () => {
        const snapshot = prSnapshot();
        // Historical/untyped snapshots may lack the current required field.
        Reflect.deleteProperty(snapshot, 'fetchedAt');
        expect(buildWorkerPrBadge(snapshot, now)).toMatchObject({ old: false, fetchedAt: null });
    });
});
