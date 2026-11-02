import { describe, expect, it } from 'vitest';

import { groupWorkersByIssue, type WorkerRow } from './groupWorkers';

function row(partial: Partial<WorkerRow> & Pick<WorkerRow, 'sessionId'>): WorkerRow {
    return { title: partial.sessionId, issueKey: null, bulb: 'idle', permissionMode: 'default', updatedAt: 0, ...partial };
}

describe('groupWorkersByIssue', () => {
    it('exposes the state-owning worker, with the most recent signal breaking urgency ties', () => {
        const quiet = row({ sessionId: 'quiet', issueKey: 'ATR-9', bulb: 'idle', updatedAt: 300 });
        const older = row({ sessionId: 'older', issueKey: 'ATR-9', bulb: 'turn', updatedAt: 400, lastActivityAt: 10 });
        const newer = row({ sessionId: 'newer', issueKey: 'ATR-9', bulb: 'turn', updatedAt: 1, lastActivityAt: 20 });
        for (const rows of [[quiet, older], [older, quiet]]) {
            expect(groupWorkersByIssue(rows)[0]).toMatchObject({ bulb: 'turn', stateWorker: older });
        }
        for (const rows of [[quiet, older, newer], [newer, older, quiet]]) {
            expect(groupWorkersByIssue(rows)[0]).toMatchObject({ bulb: 'turn', stateWorker: newer });
            expect(groupWorkersByIssue(rows)[0].workers.map(worker => worker.sessionId)).toEqual(['quiet', 'newer', 'older']);
        }
    });
    it('finding 2: a Working issue precedes a newer Waiting issue', () => {
        const groups = groupWorkersByIssue([
            row({ sessionId: 'limited', issueKey: 'ATR-7', bulb: 'waiting', updatedAt: 100 }),
            row({ sessionId: 'busy', issueKey: 'ATR-6', bulb: 'working', updatedAt: 1 }),
        ]);
        expect(groups.map((group) => [group.issueKey, group.bulb])).toEqual([
            ['ATR-6', 'working'], ['ATR-7', 'waiting'],
        ]);
    });
    it('groups by issue, most urgent first, then most recent', () => {
        const groups = groupWorkersByIssue([
            row({ sessionId: 'a', issueKey: 'HUB-59', bulb: 'working', updatedAt: 50 }),
            row({ sessionId: 'b', issueKey: 'ATR-6', bulb: 'idle', updatedAt: 90 }),
            row({ sessionId: 'c', issueKey: 'ATR-6', bulb: 'turn', updatedAt: 10 }),
            row({ sessionId: 'd', issueKey: 'MVP-80', bulb: 'working', updatedAt: 80 }),
        ]);
        expect(groups.map((g) => [g.issueKey, g.bulb])).toEqual([
            ['ATR-6', 'turn'],
            ['MVP-80', 'working'],
            ['HUB-59', 'working'],
        ]);
        expect(groups[0].workers.map((w) => w.sessionId)).toEqual(['b', 'c']);
    });

    it('N1: puts an urgent No issue group above a quiet issue', () => {
        const groups = groupWorkersByIssue([
            row({ sessionId: 'scratch', issueKey: null, bulb: 'turn', updatedAt: 99 }),
            row({ sessionId: 'a', issueKey: 'HUB-59', bulb: 'idle', updatedAt: 1 }),
        ]);
        expect(groups.map((g) => g.issueKey)).toEqual([null, 'HUB-59']);
        expect(groups[0].bulb).toBe('turn');
    });

    it('N1: puts a quiet No issue group below an urgent issue despite its newer worker', () => {
        const groups = groupWorkersByIssue([
            row({ sessionId: 'scratch', bulb: 'idle', updatedAt: 99 }),
            row({ sessionId: 'urgent', issueKey: 'ATR-6', bulb: 'turn', updatedAt: 1 }),
        ]);
        expect(groups.map((g) => g.issueKey)).toEqual(['ATR-6', null]);
    });

    it('S2: ranks a list-only No issue worker by urgency without a loaded permission mode', () => {
        const groups = groupWorkersByIssue([
            row({ sessionId: 'quiet', issueKey: 'ATR-6', updatedAt: 99 }),
            row({ sessionId: 'unloaded', bulb: 'turn', permissionMode: null, updatedAt: 1 }),
        ]);
        expect(groups.map((g) => g.issueKey)).toEqual([null, 'ATR-6']);
    });

    it('S1/S3: sorts many listed workers by urgency and each group by its newest worker', () => {
        // Only ordering is in scope; this does not promise pagination beyond the supplied rows.
        const rows = Array.from({ length: 60 }, (_, index) => row({
            sessionId: `worker-${index}`,
            issueKey: index % 6 === 0 ? null : `ATR-${index % 6}`,
            bulb: index === 0 ? 'turn' : index === 1 ? 'stuck' : 'working',
            updatedAt: index,
        }));
        const groups = groupWorkersByIssue(rows);
        expect(groups.map((g) => g.issueKey)).toEqual([null, 'ATR-1', 'ATR-5', 'ATR-4', 'ATR-3', 'ATR-2']);
        expect(groups[0].workers.map((w) => w.updatedAt)).toEqual([54, 48, 42, 36, 30, 24, 18, 12, 6, 0]);
        expect(groups.flatMap((g) => g.workers)).toHaveLength(60);
    });

    it('S3: uses recency before the final key for equally urgent groups, including No issue', () => {
        for (const noIssueTime of [9, 11]) {
            const groups = groupWorkersByIssue([
                row({ sessionId: 'issue', issueKey: 'ATR-6', bulb: 'turn', updatedAt: 10 }),
                row({ sessionId: 'scratch', bulb: 'turn', updatedAt: noIssueTime }),
            ]);
            expect(groups.map((g) => g.issueKey)).toEqual(noIssueTime > 10 ? [null, 'ATR-6'] : ['ATR-6', null]);
        }
    });

    it('S3: breaks equal urgency and timestamp ties by issue key with null last, independent of input order', () => {
        const rows = [
            row({ sessionId: 'scratch', updatedAt: 10 }),
            row({ sessionId: 'b', issueKey: 'ATR-7', updatedAt: 10 }),
            row({ sessionId: 'a', issueKey: 'ATR-6', updatedAt: 10 }),
        ];
        for (const ordered of [rows, [...rows].reverse(), [rows[1], rows[0], rows[2]]]) {
            expect(groupWorkersByIssue(ordered).map((g) => g.issueKey)).toEqual(['ATR-6', 'ATR-7', null]);
        }
    });

    it('ATR-37.3: title and mode edits do not reorder groups or workers with observed signals', () => {
        const older = { ...row({ sessionId: 'older', issueKey: 'ATR-6', updatedAt: 100 }), lastActivityAt: 10 };
        const newer = { ...row({ sessionId: 'newer', issueKey: 'ATR-7', updatedAt: 200 }), lastActivityAt: 20 };
        const newest = { ...row({ sessionId: 'newest', issueKey: 'ATR-6', updatedAt: 300 }), lastActivityAt: 30 };
        const order = (rows: WorkerRow[]) => groupWorkersByIssue(rows).map((group) => [
            group.issueKey, group.workers.map((worker) => worker.sessionId),
        ]);
        const expected = [['ATR-6', ['newest', 'older']], ['ATR-7', ['newer']]];
        expect(order([older, newer, newest])).toEqual(expected);
        expect(order([
            { ...older, title: 'Renamed', permissionMode: 'safe-yolo', updatedAt: 500 },
            { ...newer, title: 'Also renamed', permissionMode: 'yolo', updatedAt: 600 },
            newest,
        ])).toEqual(expected);
    });

    it('ATR-37.3: uses updatedAt only for workers without a signal', () => {
        const observed = { ...row({ sessionId: 'observed', issueKey: 'ATR-6', updatedAt: 999 }), lastActivityAt: 10 };
        const unobserved = row({ sessionId: 'unobserved', issueKey: 'ATR-7', updatedAt: 20 });
        expect(groupWorkersByIssue([observed, unobserved]).map((group) => group.issueKey)).toEqual(['ATR-7', 'ATR-6']);
    });

    it('returns no groups for no workers', () => {
        expect(groupWorkersByIssue([])).toEqual([]);
    });
});
