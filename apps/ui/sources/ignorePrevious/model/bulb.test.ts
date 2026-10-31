import { describe, expect, it } from 'vitest';

import { bulbFromSessionState, issueBulb } from './bulb';

describe('bulbFromSessionState', () => {
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
    it('shows the most urgent worker bulb', () => {
        expect(issueBulb(['idle', 'working', 'stuck'])).toBe('stuck');
        expect(issueBulb(['stuck', 'turn', 'working'])).toBe('turn');
        expect(issueBulb(['idle', 'working'])).toBe('working');
    });

    it('is idle with no workers', () => {
        expect(issueBulb([])).toBe('idle');
    });
});
