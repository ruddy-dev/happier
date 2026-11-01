import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderHook, standardCleanup } from '@/dev/testkit';

import {
    type ComposerRequestHandle,
    readComposerText,
    registerComposerRequestHandle,
    requestComposerFocus,
    requestComposerText,
    useComposerRequestHandle,
} from './composerRequests';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const unregisters: Array<() => void> = [];

afterEach(() => {
    while (unregisters.length > 0) unregisters.pop()?.();
    standardCleanup();
});

function buildHandle(text = ''): ComposerRequestHandle & { setText: ReturnType<typeof vi.fn>; focus: ReturnType<typeof vi.fn> } {
    return { setText: vi.fn(), getText: () => text, focus: vi.fn() };
}

function register(sessionId: string, handle: ComposerRequestHandle): () => void {
    const unregister = registerComposerRequestHandle(sessionId, handle);
    unregisters.push(unregister);
    return unregister;
}

describe('composer requests', () => {
    it('requestComposerText routes to the registered handle and focuses on request', () => {
        const handle = buildHandle();
        register('s1', handle);

        expect(requestComposerText('s1', 'Brief me', { focus: true })).toBe(true);
        expect(handle.setText).toHaveBeenCalledWith('Brief me');
        expect(handle.focus).toHaveBeenCalledTimes(1);

        expect(requestComposerText('s1', 'Again')).toBe(true);
        expect(handle.focus).toHaveBeenCalledTimes(1);
    });

    it('returns false and does not throw when nothing is registered', () => {
        expect(requestComposerText('nobody', 'hi')).toBe(false);
        expect(requestComposerFocus('nobody')).toBe(false);
        expect(readComposerText('nobody')).toBeNull();
    });

    it('last registration wins and unregistering restores the previous one', () => {
        const first = buildHandle('first');
        const second = buildHandle('second');
        register('s1', first);
        const unregisterSecond = register('s1', second);

        expect(readComposerText('s1')).toBe('second');
        expect(requestComposerFocus('s1')).toBe(true);
        expect(second.focus).toHaveBeenCalledTimes(1);
        expect(first.focus).not.toHaveBeenCalled();

        unregisterSecond();
        expect(readComposerText('s1')).toBe('first');

        unregisters.pop()?.();
        unregisters.pop()?.();
        expect(readComposerText('s1')).toBeNull();
    });

    it('the hook keeps one registration across rerenders and calls the latest handle', async () => {
        const first = buildHandle('a');
        const second = buildHandle('b');
        const hook = await renderHook(
            (props: { handle: ComposerRequestHandle }) => useComposerRequestHandle('s-hook', props.handle, true),
            { initialProps: { handle: first } },
        );

        await hook.rerender({ handle: second });
        expect(requestComposerText('s-hook', 'latest')).toBe(true);
        expect(second.setText).toHaveBeenCalledWith('latest');
        expect(first.setText).not.toHaveBeenCalled();
        expect(readComposerText('s-hook')).toBe('b');

        await hook.unmount();
        expect(readComposerText('s-hook')).toBeNull();
    });

    it('a disabled hook does not register, so requests return false until it is enabled', async () => {
        const handle = buildHandle('hidden');
        const hook = await renderHook(
            (props: { enabled: boolean }) => useComposerRequestHandle('s-disabled', handle, props.enabled),
            { initialProps: { enabled: false } },
        );

        expect(requestComposerText('s-disabled', 'ignored', { focus: true })).toBe(false);
        expect(requestComposerFocus('s-disabled')).toBe(false);
        expect(readComposerText('s-disabled')).toBeNull();
        expect(handle.setText).not.toHaveBeenCalled();
        expect(handle.focus).not.toHaveBeenCalled();

        await hook.rerender({ enabled: true });
        expect(requestComposerText('s-disabled', 'now')).toBe(true);
        expect(handle.setText).toHaveBeenCalledWith('now');
        expect(readComposerText('s-disabled')).toBe('hidden');

        await hook.rerender({ enabled: false });
        expect(readComposerText('s-disabled')).toBeNull();

        await hook.unmount();
    });
});
