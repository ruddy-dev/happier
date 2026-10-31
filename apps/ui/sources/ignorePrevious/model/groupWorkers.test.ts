import { describe, expect, it } from 'vitest';

import { groupWorkersByIssue, type WorkerRow } from './groupWorkers';

function row(partial: Partial<WorkerRow> & Pick<WorkerRow, 'sessionId'>): WorkerRow {
    return { title: partial.sessionId, issueKey: null, bulb: 'idle', permissionMode: 'default', updatedAt: 0, ...partial };
}

describe('groupWorkersByIssue', () => {
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

    it('puts workers without an issue in one last group, even when urgent', () => {
        const groups = groupWorkersByIssue([
            row({ sessionId: 'scratch', issueKey: null, bulb: 'turn', updatedAt: 99 }),
            row({ sessionId: 'a', issueKey: 'HUB-59', bulb: 'idle', updatedAt: 1 }),
        ]);
        expect(groups.map((g) => g.issueKey)).toEqual(['HUB-59', null]);
        expect(groups[1].bulb).toBe('turn');
    });

    it('returns no groups for no workers', () => {
        expect(groupWorkersByIssue([])).toEqual([]);
    });
});
