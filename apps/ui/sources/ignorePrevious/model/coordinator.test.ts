import { describe, expect, it } from 'vitest';

import { pickCoordinatorSessionId } from './coordinator';

const candidates = [
    { id: 'old', path: '/dev', active: true, archived: false, updatedAt: 10 },
    { id: 'new', path: '/dev', active: true, archived: false, updatedAt: 20 },
    { id: 'gone', path: '/dev', active: false, archived: true, updatedAt: 30 },
    { id: 'idle', path: '/dev', active: false, archived: false, updatedAt: 40 },
    { id: 'other', path: '/dev/wt/x', active: true, archived: false, updatedAt: 50 },
];

describe('pickCoordinatorSessionId', () => {
    it('keeps the stored choice while that session exists and is not archived', () => {
        expect(pickCoordinatorSessionId(candidates, { storedId: 'old', coordinatorPath: '/dev' })).toBe('old');
        expect(pickCoordinatorSessionId(candidates, { storedId: 'idle', coordinatorPath: null })).toBe('idle');
    });

    it('falls back to the newest active session in the coordinator folder', () => {
        expect(pickCoordinatorSessionId(candidates, { storedId: 'gone', coordinatorPath: '/dev' })).toBe('new');
        expect(pickCoordinatorSessionId(candidates, { storedId: 'deleted', coordinatorPath: '/dev' })).toBe('new');
    });

    it('returns null when nothing qualifies', () => {
        expect(pickCoordinatorSessionId(candidates, { storedId: 'deleted', coordinatorPath: null })).toBeNull();
        expect(pickCoordinatorSessionId(candidates, { storedId: null, coordinatorPath: '/elsewhere' })).toBeNull();
        expect(pickCoordinatorSessionId([], { storedId: null, coordinatorPath: '/dev' })).toBeNull();
    });
});
