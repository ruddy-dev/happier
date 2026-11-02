import { describe, expect, it } from 'vitest';
import { coordinatorStateLine } from './coordinatorStateLine';

describe('coordinator state line', () => {
    it('shows Thinking while replying, before the desk wait count', () => {
        expect(coordinatorStateLine({ state: 'thinking', isConnected: true }, 3)).toEqual({ kind: 'thinking' });
    });
    it.each([1, 8, 12])('uses the full shared waiting count, N=%s', count => {
        expect(coordinatorStateLine({ state: 'waiting', isConnected: true }, count)).toEqual({ kind: 'waiting', count });
    });
    it('includes coordinator questions as well as worker questions', () => {
        expect(coordinatorStateLine({ state: 'action_required', isConnected: true }, 2)).toEqual({ kind: 'waiting', count: 2 });
    });
    it('shows Idle when connected with no reply or waits', () => {
        expect(coordinatorStateLine({ state: 'waiting', isConnected: true }, 0)).toEqual({ kind: 'idle' });
    });
    it('does not call background activity a coordinator reply', () => {
        expect(coordinatorStateLine({ state: 'background_active', isConnected: true }, 0)).toEqual({ kind: 'idle' });
    });
    it.each(['thinking', 'disconnected', 'resuming'] as const)('shows offline over stale %s and waits', state => {
        expect(coordinatorStateLine({ state, isConnected: false }, 4)).toEqual({ kind: 'offline' });
    });
    it('does not assume a missing record is online', () => {
        expect(coordinatorStateLine(null, 3)).toEqual({ kind: 'offline' });
    });
});
