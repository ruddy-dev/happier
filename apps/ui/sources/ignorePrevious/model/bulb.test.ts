import { describe, expect, it } from 'vitest';

import { bulbFromSessionState, issueBulb } from './bulb';

describe('bulbFromSessionState', () => {
    it.each(['thinking', 'background_active', 'resuming'] as const)('finding 3: busy %s stays Working with a current limit', (state) => {
        expect(bulbFromSessionState(state, true)).toBe('working');
    });
    it.each(['failed', 'waiting', 'disconnected'] as const)('finding 3: non-busy %s with a current limit is Waiting', (state) => {
        expect(bulbFromSessionState(state, true)).toBe('waiting');
    });
    it('maps every session state to one bulb', () => {
        expect(bulbFromSessionState('permission_required')).toBe('turn');
        expect(bulbFromSessionState('action_required')).toBe('turn');
        expect(bulbFromSessionState('failed')).toBe('stuck');
        expect(bulbFromSessionState('recoverable_unservable')).toBe('stuck');
        expect(bulbFromSessionState('thinking')).toBe('working');
        expect(bulbFromSessionState('background_active')).toBe('working');
        expect(bulbFromSessionState('resuming')).toBe('working');
        expect(bulbFromSessionState('archiving')).toBe('working');
        expect(bulbFromSessionState('waiting')).toBe('idle');
        expect(bulbFromSessionState('disconnected')).toBe('idle');
    });
});

describe('issueBulb', () => {
    it('finding 2: Working outranks Waiting on a mixed issue', () => {
        expect(issueBulb(['waiting', 'working'])).toBe('working');
    });
    it('shows the most urgent worker bulb', () => {
        expect(issueBulb(['idle', 'working', 'stuck'])).toBe('stuck');
        expect(issueBulb(['stuck', 'turn', 'working'])).toBe('turn');
        expect(issueBulb(['idle', 'working'])).toBe('working');
    });

    it('is idle with no workers', () => {
        expect(issueBulb([])).toBe('idle');
    });
});
