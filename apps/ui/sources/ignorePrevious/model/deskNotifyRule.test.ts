import { describe, expect, it } from 'vitest';
import { deskNotifyRule, type DeskNotifySnapshot } from './deskNotifyRule';

const empty: DeskNotifySnapshot = { waitIds: [], waitSessionIds: {}, loadingSessionSinceMs: {}, observedAtMs: 0, workerBulbs: [], ready: true };
const waiting: DeskNotifySnapshot = { ...empty, waitIds: ['one'], waitSessionIds: { one: 'worker', two: 'worker' }, workerBulbs: ['turn', 'stuck', 'waiting', 'idle'] };

describe('deskNotifyRule', () => {
    it('every absorbs staged details through completion, then alerts for the next new request', () => {
        const placeholder = { ...empty, waitIds: ['unloaded:worker'], waitSessionIds: { 'unloaded:worker': 'worker' }, loadingSessionSinceMs: { worker: 0 } };
        const partial = { ...waiting, loadingSessionSinceMs: { worker: 0 }, observedAtMs: 30_000 };
        const loaded = { ...waiting, waitIds: ['one', 'two'], observedAtMs: 60_000 };
        expect(deskNotifyRule(placeholder, partial, 'every')).toBe(false);
        expect(deskNotifyRule(partial, loaded, 'every')).toBe(false);
        expect(deskNotifyRule(loaded, { ...loaded, waitIds: ['one', 'two', 'three'] }, 'every')).toBe(true);
    });

    it('every stops absorbing ids after 60 seconds even if loading never finishes', () => {
        const partial = { ...waiting, loadingSessionSinceMs: { worker: 0 } };
        const next = { ...partial, waitIds: ['one', 'two'], observedAtMs: 60_001 };
        expect(deskNotifyRule(partial, next, 'every')).toBe(true);
        const placeholder = { ...partial, waitIds: ['unloaded:worker'], waitSessionIds: { 'unloaded:worker': 'worker' }, loadingSessionSinceMs: { worker: 0 } };
        expect(deskNotifyRule(placeholder, next, 'every')).toBe(true);
    });
    it('every fires only for a newly appearing id, including removal and reappearance', () => {
        expect(deskNotifyRule(empty, waiting, 'every')).toBe(true);
        expect(deskNotifyRule(waiting, { ...waiting, waitIds: ['one'] }, 'every')).toBe(false);
        expect(deskNotifyRule(waiting, empty, 'every')).toBe(false);
        expect(deskNotifyRule(empty, waiting, 'every')).toBe(true);
        expect(deskNotifyRule(waiting, { ...waiting, waitIds: ['two', 'one'] }, 'every')).toBe(true);
        expect(deskNotifyRule({ ...waiting, waitIds: ['one', 'two'] }, { ...waiting, waitIds: ['two', 'one'] }, 'every')).toBe(false);
    });

    it('blocked fires once on entry and again only after leaving and reentering', () => {
        expect(deskNotifyRule(empty, waiting, 'blocked')).toBe(true);
        expect(deskNotifyRule(waiting, { ...waiting, waitIds: ['one', 'two'] }, 'blocked')).toBe(false);
        expect(deskNotifyRule(waiting, empty, 'blocked')).toBe(false);
        expect(deskNotifyRule(empty, waiting, 'blocked')).toBe(true);
    });

    it('a working worker prevents blocked and its stopping re-arms the transition', () => {
        const moving = { ...waiting, workerBulbs: [...waiting.workerBulbs, 'working' as const] };
        expect(deskNotifyRule(empty, moving, 'blocked')).toBe(false);
        expect(deskNotifyRule(moving, waiting, 'blocked')).toBe(true);
        expect(deskNotifyRule(waiting, moving, 'blocked')).toBe(false);
        expect(deskNotifyRule(moving, waiting, 'blocked')).toBe(true);
        expect(deskNotifyRule(empty, moving, 'every')).toBe(true);
    });

    it('every does not treat loaded details for a previous placeholder as a new wait', () => {
        const unloaded = { ...empty, waitIds: ['unloaded:worker'], waitSessionIds: { 'unloaded:worker': 'worker' }, loadingSessionSinceMs: { worker: 0 } };
        const loaded = { ...empty, waitIds: ['request-one', 'request-two'], waitSessionIds: { 'request-one': 'worker', 'request-two': 'worker' } };
        expect(deskNotifyRule(unloaded, loaded, 'every')).toBe(false);
        const otherSession = { ...loaded, waitIds: [...loaded.waitIds, 'other-request'],
            waitSessionIds: { ...loaded.waitSessionIds, 'other-request': 'other' } };
        expect(deskNotifyRule(unloaded, otherSession, 'every')).toBe(true);
    });

    it('every fires once for a new placeholder and not again when its details arrive', () => {
        const unloaded = { ...empty, waitIds: ['unloaded:worker'], waitSessionIds: { 'unloaded:worker': 'worker' }, loadingSessionSinceMs: { worker: 0 } };
        const loaded = { ...empty, waitIds: ['request'], waitSessionIds: { request: 'worker' } };
        expect(deskNotifyRule(empty, unloaded, 'every')).toBe(true);
        expect(deskNotifyRule(unloaded, unloaded, 'every')).toBe(false);
        expect(deskNotifyRule(unloaded, loaded, 'every')).toBe(false);
    });

    it('blocked counts an unloaded placeholder as a wait', () => {
        const unloaded = { ...empty, waitIds: ['unloaded:worker'], waitSessionIds: { 'unloaded:worker': 'worker' }, loadingSessionSinceMs: { worker: 0 } };
        expect(deskNotifyRule(empty, unloaded, 'blocked')).toBe(true);
        expect(deskNotifyRule(unloaded, unloaded, 'blocked')).toBe(false);
        expect(deskNotifyRule(empty, { ...unloaded, workerBulbs: ['working'] }, 'blocked')).toBe(false);
    });

    it.each(['every', 'blocked'] as const)('%s ignores loading and baselines the first ready snapshot', setting => {
        expect(deskNotifyRule(undefined, waiting, setting)).toBe(false);
        expect(deskNotifyRule(empty, { ...waiting, ready: false }, setting)).toBe(false);
        expect(deskNotifyRule({ ...empty, ready: false }, waiting, setting)).toBe(false);
        expect(deskNotifyRule(undefined, { ...waiting, ready: false }, setting)).toBe(false);
    });
});
