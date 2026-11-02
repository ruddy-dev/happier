import { describe, expect, it } from 'vitest';
import { advanceCreatureMode, type CreatureModeInput } from './creatureMode';

const idle: CreatureModeInput = { coordinator: 'idle', waitingCount: 0, requests: [], unloadedSessionIds: [], nowMs: 0 };
const r1 = { sessionId: 'worker', requestId: 'r1' };

describe('creature mode', () => {
    it('M13 rises once for a new request, rests at 3 s, and never bursts on a phone answer', () => {
        const baseline = advanceCreatureMode(null, idle);
        const input = { ...idle, waitingCount: 1, requests: [r1], nowMs: 100 };
        const burst = advanceCreatureMode(baseline, input);
        expect(burst.mode).toBe('burst');
        expect(advanceCreatureMode(burst, { ...input, nowMs: 3099 }).mode).toBe('burst');
        const rest = advanceCreatureMode(burst, { ...input, nowMs: 3100 });
        expect(rest.mode).toBe('rest');
        const answered = advanceCreatureMode(rest, { ...idle, nowMs: 3200 });
        expect(answered.mode).toBe('rest');
        expect(advanceCreatureMode(answered, { ...idle, nowMs: 3300 }).mode).toBe('rest');
    });

    it('M13 detects a new request replacing another at the same count', () => {
        const baseline = advanceCreatureMode(null, { ...idle, waitingCount: 1, requests: [r1] });
        expect(baseline.mode).toBe('rest');
        expect(advanceCreatureMode(baseline, {
            ...idle, waitingCount: 1, requests: [{ ...r1, requestId: 'r2' }], nowMs: 100,
        }).mode).toBe('burst');
    });

    it('M13 counts an unloaded wait once and does not burst again when its details load', () => {
        const baseline = advanceCreatureMode(null, idle);
        const unloaded = advanceCreatureMode(baseline, { ...idle, waitingCount: 1, unloadedSessionIds: ['worker'], nowMs: 10 });
        expect(unloaded.mode).toBe('burst');
        const loaded = advanceCreatureMode(unloaded, { ...idle, waitingCount: 2, requests: [r1, { ...r1, requestId: 'r2' }], nowMs: 3010 });
        expect(loaded.mode).toBe('rest');
    });

    it('M13 hydration and an answered unloaded wait establish a baseline without a burst', () => {
        const cold = advanceCreatureMode(null, { ...idle, waitingCount: null });
        const warm = advanceCreatureMode(cold, { ...idle, waitingCount: 1, unloadedSessionIds: ['worker'], nowMs: 10 });
        expect(warm.mode).toBe('rest');
        expect(advanceCreatureMode(warm, { ...idle, nowMs: 20 }).mode).toBe('rest');
    });

    it('M13 a null-to-number count with loaded requests establishes a baseline', () => {
        const cold = advanceCreatureMode(null, { ...idle, waitingCount: null });
        expect(advanceCreatureMode(cold, { ...idle, waitingCount: 1, requests: [r1], nowMs: 10 }).mode).toBe('rest');
    });

    it('F6 forgets closed requests but retains identities while their session is unloaded', () => {
        const r2 = { sessionId: 'other-worker', requestId: 'r2' };
        const baseline = advanceCreatureMode(null, { ...idle, waitingCount: 2, requests: [r1, r2] });
        const unloaded = advanceCreatureMode(baseline, {
            ...idle, waitingCount: 1, unloadedSessionIds: [r1.sessionId], nowMs: 10,
        });
        expect(unloaded.seenRequestKeys).toEqual([JSON.stringify([r1.sessionId, r1.requestId])]);
        const loaded = advanceCreatureMode(unloaded, { ...idle, waitingCount: 1, requests: [r1], nowMs: 20 });
        expect(loaded.mode).toBe('rest');
        expect(loaded.seenRequestKeys).toEqual([JSON.stringify([r1.sessionId, r1.requestId])]);
        const answered = advanceCreatureMode(loaded, { ...idle, nowMs: 30 });
        expect(answered.seenRequestKeys).toEqual([]);
    });

    it('F6 a request arriving during explicit Calm does not burst when Calm ends', () => {
        const baseline = advanceCreatureMode(null, idle);
        const calm = advanceCreatureMode(baseline, { ...idle, calm: true, waitingCount: 1, requests: [r1], nowMs: 10 });
        expect(calm.mode).toBe('calm');
        expect(advanceCreatureMode(calm, { ...idle, waitingCount: 1, requests: [r1], nowMs: 20 }).mode).toBe('rest');
    });

    it.each(['none', 'offline', 'resuming'] as const)('M14 %s stays calm even when new requests arrive', coordinator => {
        const baseline = advanceCreatureMode(null, idle);
        const calm = advanceCreatureMode(baseline, { ...idle, coordinator, waitingCount: 1, requests: [r1], nowMs: 10 });
        expect(calm.mode).toBe('calm');
        expect(advanceCreatureMode(calm, { ...idle, waitingCount: 1, requests: [r1], nowMs: 20 }).mode).toBe('rest');
    });

    it('M14 only replying is working; explicit Calm overrides replying', () => {
        expect(advanceCreatureMode(null, { ...idle, coordinator: 'replying' }).mode).toBe('working');
        expect(advanceCreatureMode(null, { ...idle, coordinator: 'replying', calm: true }).mode).toBe('calm');
    });
});
