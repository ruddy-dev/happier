import * as React from 'react';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderScreen } from '@/dev/testkit';
import { DeskCreature } from './DeskCreature';
import { CreatureFixture } from '../fixtures/CreatureFixture';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock({ Platform: { OS: 'ios' } });
});

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('creature native fallback and fixture controls', () => {
    it('M15 native exposes a labelled still without loading the browser engine', async () => {
        vi.stubGlobal('requestAnimationFrame', vi.fn());
        const screen = await renderScreen(<DeskCreature style="terminal" redEyes={2} mode="working" />);
        expect(screen.findByTestId('ip-creature')?.props.accessibilityLabel).toMatch(/working.*still/i);
        expect(requestAnimationFrame).not.toHaveBeenCalled();
        await screen.unmount();
    });

    it('M13 M14 fixture controls feed real mode transitions and a phone answer never replays a burst', async () => {
        vi.useFakeTimers();
        const screen = await renderScreen(<CreatureFixture />);
        const press = async (label: string) => act(async () => {
            screen.tree.findByProps({ accessibilityRole: 'button', accessibilityLabel: label }).props.onPress();
        });
        const label = () => screen.findByTestId('ip-creature')?.props.accessibilityLabel;
        await press('New request');
        expect(label()).toMatch(/new.*turn/i);
        await act(async () => vi.advanceTimersByTime(3000));
        expect(label()).toMatch(/rest/i);
        await press('Answer on phone');
        expect(label()).toMatch(/rest/i);
        await press('Replying');
        expect(label()).toMatch(/working/i);
        await press('Offline');
        expect(label()).toMatch(/calm.*still/i);
        await screen.unmount();
        expect(vi.getTimerCount()).toBe(0);
    });
});
