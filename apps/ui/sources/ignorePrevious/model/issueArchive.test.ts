import { describe, expect, it } from 'vitest';
import { createSessionFixture } from '@/dev/testkit';
import { buildSessionListRenderableFromSession } from '@/sync/domains/session/listing/sessionListRenderable';
import type { Session } from '@/sync/domains/state/storageTypes';
import { deriveIssueArchive } from './issueArchive';

const now = 1_800_000_000_000;
const row = (id: string, extra: Partial<Session> = {}) => buildSessionListRenderableFromSession(createSessionFixture({
    id, updatedAt: now, activeAt: now, ...extra,
}));

describe('issue archive rule', () => {
    it('L4: merge alone offers the button but does not retire an issue', () => {
        expect(deriveIssueArchive('ATR-6', [row('stopped')], { stopped: 'merged' }, null, now))
            .toEqual({ canArchive: true, archivableSessionIds: ['stopped'], retired: false });
    });

    it('N: a running idle session stays while stopped sessions can archive', () => {
        expect(deriveIssueArchive('ATR-6', [row('stopped'), row('running', { active: true })], { stopped: 'merged' }, null, now))
            .toEqual({ canArchive: true, archivableSessionIds: ['stopped'], retired: false });
    });

    it.each(['thinking', 'background', 'resuming', 'permission', 'question', 'unloaded-request'] as const)('L4: %s blocks the entire issue', kind => {
        const worker = row('blocked', {
            active: true,
            ...(kind === 'thinking' ? { thinking: true, thinkingAt: now } : {}),
            ...(kind === 'background' ? { runtimeActivityState: 'active', runtimeActivityActiveCount: 1, runtimeActivityObservedAt: now, runtimeActivityRevision: 1 } : {}),
            ...(kind === 'resuming' ? { resumingAt: now } : {}),
            ...(kind === 'permission' || kind === 'question' ? { agentState: { requests: { req: {
                tool: kind === 'question' ? 'AskUserQuestion' : 'Bash', arguments: {}, createdAt: now,
            } } } } : {}),
        });
        if (kind === 'unloaded-request') worker.hasPendingUserActionRequests = true;
        const model = deriveIssueArchive('ATR-6', [row('stopped'), worker], { stopped: 'merged' }, null, now);
        expect(model.canArchive).toBe(false);
        expect(model.archivableSessionIds).toEqual([]);
        expect(model.retired).toBe(false);
    });

    it('L1/L4: the coordinator is never a target or retirement blocker', () => {
        expect(deriveIssueArchive('ATR-6', [row('coord', { active: true, thinking: true, thinkingAt: now }), row('worker')], { worker: 'merged' }, 'coord', now))
            .toMatchObject({ canArchive: true, archivableSessionIds: ['worker'] });
        expect(deriveIssueArchive('ATR-6', [row('coord')], { coord: 'merged' }, 'coord', now))
            .toEqual({ canArchive: false, archivableSessionIds: [], retired: false });
    });

    it.each([null, 'unknown', 'open', 'closed'] as const)('N: PR state %s offers no Archive', state => {
        expect(deriveIssueArchive('ATR-6', [row('worker')], { worker: state }, null, now).canArchive).toBe(false);
    });

    it('N: no-issue sessions never offer an issue Archive', () => {
        expect(deriveIssueArchive(null, [row('worker')], { worker: 'merged' }, null, now).canArchive).toBe(false);
    });

    it('L4: retirement is derivable only once all issue sessions are archived', () => {
        const archived = row('archived', { archivedAt: now });
        expect(deriveIssueArchive('ATR-6', [archived, row('worker')], { archived: 'merged' }, null, now))
            .toEqual({ canArchive: true, archivableSessionIds: ['worker'], retired: false });
        expect(deriveIssueArchive('ATR-6', [archived], {}, null, now))
            .toEqual({ canArchive: false, archivableSessionIds: [], retired: true });
        expect(deriveIssueArchive('ATR-6', [], {}, null, now).retired).toBe(false);
    });
});
