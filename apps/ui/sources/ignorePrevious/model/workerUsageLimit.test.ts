import { describe, expect, it } from 'vitest';
import { createSessionFixture } from '@/dev/testkit/fixtures/sessionFixtures';
import { buildSessionListRenderableFromSession } from '@/sync/domains/session/listing/sessionListRenderable';

import { armedUsageLimitRecovery, usageLimitIssue } from '../testkit/usageLimitFixtures';
import { workerUsageLimit } from './workerUsageLimit';
import { bulbFromSessionState } from './bulb';

const issue = usageLimitIssue(10_000, 90_000);
const row = buildSessionListRenderableFromSession(createSessionFixture({
    active: true, latestTurnStatus: 'failed', latestTurnStatusObservedAt: 10_000, lastRuntimeIssue: issue,
}));

describe('workerUsageLimit F5', () => {
    it.each(['paused', 'exhausted'] as const)('finding 1: %s recovery makes no armed claim', (status) => {
        expect(workerUsageLimit(row, { ...armedUsageLimitRecovery(issue), status })?.autoResumeArmed).toBe(false);
    });
    it.each(['armed', 'waiting', 'checking'] as const)('finding 1: %s recovery is armed', (status) => {
        expect(workerUsageLimit(row, { ...armedUsageLimitRecovery(issue), status })?.autoResumeArmed).toBe(true);
    });
    it('F5: reads a reset time from the list without claiming auto-resume is armed', () => {
        expect(workerUsageLimit(row)).toEqual({ current: true, resetAtMs: 90_000, autoResumeArmed: null });
    });
    it('F5: keeps a limit without a known reset time', () => {
        expect(workerUsageLimit({ ...row, lastRuntimeIssue: usageLimitIssue(10_000) }))
            .toEqual({ current: true, resetAtMs: null, autoResumeArmed: null });
    });
    it('F5: reads armed auto-resume and its newer reset from matching loaded recovery metadata', () => {
        expect(workerUsageLimit(row, { ...armedUsageLimitRecovery(issue), resetAtMs: 100_000 }))
            .toEqual({ current: true, resetAtMs: 100_000, autoResumeArmed: true });
    });
    it('F5: drops a stale limit after a later successful turn', () => {
        expect(workerUsageLimit({ ...row, latestTurnStatus: 'completed', latestTurnStatusObservedAt: 20_000, meaningfulActivityAt: 20_000 })).toBeNull();
    });
    it('F5: drops a limit when a new in-progress turn has meaningful provider activity', () => {
        expect(workerUsageLimit({ ...row, latestTurnStatus: 'in_progress', latestTurnStatusObservedAt: 20_000, meaningfulActivityAt: 20_000 })).toBeNull();
    });
    it('F5: terminal limit text and a thinking heartbeat alone do not prove recovery', () => {
        expect(workerUsageLimit({ ...row, meaningfulActivityAt: 20_000, thinking: true })?.current).toBe(true);
        expect(workerUsageLimit({ ...row, latestTurnStatus: 'in_progress', thinking: true, meaningfulActivityAt: 10_500 })?.current).toBe(true);
    });
    it('F5: an inactive limited worker keeps its line and a waiting bulb', () => {
        const status = workerUsageLimit({ ...row, active: false });
        expect(status?.current).toBe(true);
        expect(bulbFromSessionState('disconnected', status !== null)).toBe('waiting');
    });
    it('F5: a real permission request keeps priority over a limit on the same worker', () => {
        expect(bulbFromSessionState('permission_required', true)).toBe('turn');
    });
    it('F5: no runtime issue means no line', () => {
        expect(workerUsageLimit({ ...row, lastRuntimeIssue: null })).toBeNull();
    });
    it('F5: non-limit errors and temporary throttles are not usage limits', () => {
        expect(workerUsageLimit({ ...row, lastRuntimeIssue: { ...issue, source: 'provider_process_exit', usageLimit: undefined } })).toBeNull();
        expect(workerUsageLimit({ ...row, lastRuntimeIssue: { ...issue, source: 'provider_status_error', usageLimit: undefined, temporaryThrottle: { v: 1, retryAfterMs: 100, recoverability: 'retry' } } })).toBeNull();
    });
    it('F5: ignores an old recovery intent and malformed recovery data', () => {
        const old = armedUsageLimitRecovery(usageLimitIssue(1_000));
        expect(workerUsageLimit(row, old)).toEqual({ current: true, resetAtMs: 90_000, autoResumeArmed: false });
        expect(workerUsageLimit(row, { status: 'armed' })?.autoResumeArmed).toBe(false);
    });
    it('F5: hides a cancelled recovery for this issue, following SessionView', () => {
        expect(workerUsageLimit(row, { ...armedUsageLimitRecovery(issue), status: 'cancelled' })).toBeNull();
    });
});
