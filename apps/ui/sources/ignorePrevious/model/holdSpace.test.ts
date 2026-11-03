import { describe, expect, it } from 'vitest';
import { reduceHoldSpace, type HoldSpaceEvent } from './holdSpace';

const down = {
    type: 'keydown', key: ' ', repeat: false,
    shiftKey: false, ctrlKey: false, altKey: false, metaKey: false,
    isComposing: false, keyCode: 32,
    isSessionInput: true, isInputEmpty: true, dictationActive: false, enabled: true,
} satisfies HoldSpaceEvent;
const idle = { phase: 'idle' } as const;
const holding = { phase: 'holding' } as const;
const untouched = { next: idle, action: null, preventDefault: false };

describe('hold Space gesture', () => {
    it('starts only a fresh Space in an empty coordinator input', () => {
        expect(reduceHoldSpace(idle, down)).toEqual({ next: holding, action: 'start', preventDefault: true });
    });
    it.each([
        { repeat: true }, { shiftKey: true }, { ctrlKey: true }, { altKey: true }, { metaKey: true },
        { isComposing: true }, { keyCode: 229 }, { isSessionInput: false }, { isInputEmpty: false },
        { dictationActive: true }, { enabled: false }, { key: 'Spacebar' }, { type: 'keyup' as const },
    ])('leaves the idle event alone with guard %j', (guard) => {
        expect(reduceHoldSpace(idle, { ...down, ...guard })).toEqual(untouched);
    });
    it('prevents repeated Space while holding without starting again', () => {
        expect(reduceHoldSpace(holding, { ...down, repeat: true })).toEqual({ next: holding, action: null, preventDefault: true });
    });
    it('releases on keyup even if focus, contents or modifiers changed', () => {
        expect(reduceHoldSpace(holding, { ...down, type: 'keyup', shiftKey: true, isSessionInput: false, isInputEmpty: false }))
            .toEqual({ next: idle, action: 'release', preventDefault: true });
    });
    it('cancels on Escape', () => {
        expect(reduceHoldSpace(holding, { ...down, key: 'Escape' })).toEqual({ next: idle, action: 'cancel', preventDefault: true });
    });
    it.each(['blur', 'hidden'] as const)('releases on %s', (type) => {
        expect(reduceHoldSpace(holding, { type })).toEqual({ next: idle, action: 'release', preventDefault: false });
        expect(reduceHoldSpace(idle, { type })).toEqual(untouched);
    });
    it.each(['a', 'Enter', 'Shift'])('passes %s through while holding', (key) => {
        expect(reduceHoldSpace(holding, { ...down, key })).toEqual({ next: holding, action: null, preventDefault: false });
    });
});
