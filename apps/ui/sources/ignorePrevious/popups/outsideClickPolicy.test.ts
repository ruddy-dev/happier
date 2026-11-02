import { describe, expect, it } from 'vitest';
import { shouldCloseOnOutsideClick } from './outsideClickPolicy';

describe('Q13 outside click policy', () => {
    it.each([
        ['docked', false, false],
        ['docked', true, false],
        ['overlay', false, true],
        ['overlay', true, false],
    ] as const)('%s, half answered %s → close %s', (presentation, hasHalfAnsweredCard, expected) => {
        expect(shouldCloseOnOutsideClick({ presentation, hasHalfAnsweredCard })).toBe(expected);
    });
});
