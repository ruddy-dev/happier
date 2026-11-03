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
        { shiftKey: true }, { ctrlKey: true }, { altKey: true }, { metaKey: true },
        { isComposing: true }, { keyCode: 229 }, { isSessionInput: false }, { isInputEmpty: false },
        { dictationActive: true }, { enabled: false }, { key: 'Spacebar' }, { type: 'keyup' as const },
    ])('leaves the idle event alone with guard %j', (guard) => {
        expect(reduceHoldSpace(idle, { ...down, ...guard })).toEqual(untouched);
    });
    it('prevents repeated Space while holding without starting again', () => {
        expect(reduceHoldSpace(holding, { ...down, repeat: true })).toEqual({ next: holding, action: null, preventDefault: true });
    });
    it.each([false, true])('passes idle Space repeats through with dictationActive=%s', (dictationActive) => {
        expect(reduceHoldSpace(idle, { ...down, repeat: true, dictationActive })).toEqual(untouched);
    });
    it.each([
        { shiftKey: true }, { ctrlKey: true }, { altKey: true }, { metaKey: true },
        { isComposing: true }, { keyCode: 229 }, { isSessionInput: false }, { isInputEmpty: false },
        { enabled: false },
    ])('passes idle Space repeats through with guard %j', (guard) => {
        expect(reduceHoldSpace(idle, { ...down, repeat: true, ...guard })).toEqual(untouched);
    });
    it('ends suppression on a fresh Space press after a lost keyup and handles it as a new press', () => {
        const suppressing = { phase: 'suppressing' } as const;
        // A new physical press elsewhere types normally.
        expect(reduceHoldSpace(suppressing, { ...down, isSessionInput: false })).toEqual(untouched);
        // A new physical press in the empty coordinator box starts a new hold.
        expect(reduceHoldSpace(suppressing, down)).toEqual({ next: holding, action: 'start', preventDefault: true });
        // Repeats of the interrupted press are still swallowed.
        expect(reduceHoldSpace(suppressing, { ...down, repeat: true, isSessionInput: false }))
            .toEqual({ next: suppressing, action: null, preventDefault: true });
    });
    it('releases on keyup even if focus, contents or modifiers changed', () => {
        expect(reduceHoldSpace(holding, { ...down, type: 'keyup', shiftKey: true, isSessionInput: false, isInputEmpty: false }))
            .toEqual({ next: idle, action: 'release', preventDefault: true });
    });
    it('cancels on Escape and suppresses leftover repeats without another action', () => {
        const started = reduceHoldSpace(idle, down);
        const cancelled = reduceHoldSpace(started.next, { ...down, key: 'Escape' });
        expect(cancelled).toEqual({ next: { phase: 'suppressing' }, action: 'cancel', preventDefault: true });
        for (let repeat = 0; repeat < 3; repeat++) {
            expect(reduceHoldSpace(cancelled.next, { ...down, repeat: true }))
                .toEqual({ next: cancelled.next, action: null, preventDefault: true });
        }
        expect(reduceHoldSpace(cancelled.next, { ...down, type: 'keyup' })).toEqual(untouched);
    });
    it.each(['blur', 'hidden'] as const)('clears suppression on %s without releasing again', (type) => {
        const cancelled = reduceHoldSpace(holding, { ...down, key: 'Escape' });
        const cleared = reduceHoldSpace(cancelled.next, { type });
        expect(cleared).toEqual(untouched);
        expect(reduceHoldSpace(cleared.next, { ...down, repeat: true })).toEqual(untouched);
    });
    it.each(['a', 'Enter', 'Shift', 'Escape'])('keeps suppression on %s keydown and keyup', (key) => {
        const cancelled = reduceHoldSpace(holding, { ...down, key: 'Escape' });
        for (const type of ['keydown', 'keyup'] as const) {
            expect(reduceHoldSpace(cancelled.next, { ...down, key, type }))
                .toEqual({ next: cancelled.next, action: null, preventDefault: false });
        }
    });
    it.each(['blur', 'hidden'] as const)('releases on %s', (type) => {
        expect(reduceHoldSpace(holding, { type })).toEqual({ next: idle, action: 'release', preventDefault: false });
        expect(reduceHoldSpace(idle, { type })).toEqual(untouched);
    });
    it.each(['a', 'Enter', 'Shift'])('passes %s through while holding', (key) => {
        expect(reduceHoldSpace(holding, { ...down, key })).toEqual({ next: holding, action: null, preventDefault: false });
    });
});
