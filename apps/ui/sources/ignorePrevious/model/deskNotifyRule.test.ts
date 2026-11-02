import { describe, expect, it } from 'vitest';
import { deskNotifyRule, type DeskNotifySnapshot } from './deskNotifyRule';

const empty: DeskNotifySnapshot = { waitIds: [], workerBulbs: [], ready: true };
const waiting: DeskNotifySnapshot = { waitIds: ['one'], workerBulbs: ['turn', 'stuck', 'waiting', 'idle'], ready: true };

describe('deskNotifyRule', () => {
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

    it.each(['every', 'blocked'] as const)('%s ignores loading and baselines the first ready snapshot', setting => {
        expect(deskNotifyRule(undefined, waiting, setting)).toBe(false);
        expect(deskNotifyRule(empty, { ...waiting, ready: false }, setting)).toBe(false);
        expect(deskNotifyRule({ ...empty, ready: false }, waiting, setting)).toBe(false);
        expect(deskNotifyRule(undefined, { ...waiting, ready: false }, setting)).toBe(false);
    });
});
