/** @vitest-environment jsdom */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeskCreature, CREATURE_RUN_CAP_MS } from './DeskCreature.web';
import type { DeskCreatureProps } from './DeskCreature.types';
import { useCreatureMode } from './useCreatureMode';
import { CREATURE_BURST_MS, type CreatureModeInput } from './creatureMode';

const preference = vi.hoisted(() => {
    // Path2D is constructed at module load by the copied mask artwork.
    globalThis.Path2D = class { roundRect() {} arc() {} addPath() {} } as unknown as typeof Path2D;
    return { reduced: false };
});
vi.mock('@/hooks/ui/useReducedMotionPreference', async () => {
    const { createReducedMotionModuleMock } = await import('@/dev/testkit/mocks/reducedMotion');
    return createReducedMotionModuleMock(() => preference.reduced);
});
vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock();
});
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;
let hidden: boolean;
let nextFrame: number;
let frames: Map<number, FrameRequestCallback>;
let observers: Set<IntersectionObserverCallback>;

async function render(props: Partial<DeskCreatureProps> = {}, second = false) {
    await act(async () => root.render(<>
        <DeskCreature style="slips" redEyes={1} mode="working" {...props} />
        {second && <DeskCreature style="terminal" redEyes={2} mode="working" />}
    </>));
    await act(async () => vi.dynamicImportSettled());
}
async function intersect(visible: boolean) {
    await act(async () => {
        for (const callback of observers) callback([{ isIntersecting: visible } as IntersectionObserverEntry], {} as IntersectionObserver);
    });
}
async function visibility(value: boolean) {
    hidden = value;
    await act(async () => document.dispatchEvent(new Event('visibilitychange')));
}

beforeEach(() => {
    vi.useFakeTimers();
    preference.reduced = false;
    hidden = false;
    nextFrame = 0;
    frames = new Map();
    observers = new Set();
    vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame; }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => frames.delete(id)));
    vi.stubGlobal('IntersectionObserver', class {
        constructor(private callback: IntersectionObserverCallback) { observers.add(callback); }
        observe() {}
        disconnect() { observers.delete(this.callback); }
    });
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(240);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(128);
    // jsdom has no canvas. Keep the drawing engine real; stub only its browser drawing boundary.
    const noop = () => {};
    // The browser method has 2D/WebGL/GPU overloads; this fixture only requests 2D.
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(((contextId: string) => contextId === '2d' ? new Proxy({}, {
        get: (_target, key) => {
            if (key === 'getImageData') return (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) });
            if (key === 'createLinearGradient' || key === 'createRadialGradient') return () => ({ addColorStop: noop });
            if (key === 'measureText') return () => ({ width: 8 });
            return noop;
        },
    }) : null) as HTMLCanvasElement['getContext']);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
});
afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

describe('DeskCreature browser lifecycle', () => {
    it('M15 without IntersectionObserver stays still instead of assuming visibility', async () => {
        vi.stubGlobal('IntersectionObserver', undefined);
        await render();
        expect(container.querySelector('canvas')).not.toBeNull();
        expect(requestAnimationFrame).not.toHaveBeenCalled();
    });
    it('M13 the consumer hook expires a burst at exactly 3 s and clears its timer on unmount', async () => {
        const input = { coordinator: 'idle', waitingCount: 0, requests: [], unloadedSessionIds: [] } satisfies Omit<CreatureModeInput, 'nowMs'>;
        function Probe({ value }: { value: Omit<CreatureModeInput, 'nowMs'> }) {
            return <output>{useCreatureMode(value)}</output>;
        }
        await act(async () => root.render(<Probe value={input} />));
        await act(async () => root.render(<Probe value={{ ...input, waitingCount: 1, requests: [{ sessionId: 'worker', requestId: 'request' }] }} />));
        expect(container.textContent).toBe('burst');
        await act(async () => vi.advanceTimersByTime(2999));
        expect(container.textContent).toBe('burst');
        await act(async () => vi.advanceTimersByTime(1));
        expect(container.textContent).toBe('rest');
        await act(async () => root.render(<Probe value={{ ...input, waitingCount: 1, requests: [{ sessionId: 'worker', requestId: 'next' }] }} />));
        expect(container.textContent).toBe('burst');
        await act(async () => root.render(null));
        expect(vi.getTimerCount()).toBe(0);
    });
    it.each(['rest', 'calm'] as const)('M15 %s has a canvas still and never requests a frame', async mode => {
        await render({ mode });
        await intersect(true);
        expect(container.querySelector('canvas')).not.toBeNull();
        expect(requestAnimationFrame).not.toHaveBeenCalled();
    });

    it('M15 waits for intersection, stops offscreen, resumes the same canvas, and stops hidden', async () => {
        await render();
        expect(frames.size).toBe(0);
        await intersect(true);
        expect(frames.size).toBe(1);
        const canvas = container.querySelector('canvas');
        await intersect(false);
        expect(frames.size).toBe(0);
        await intersect(true);
        expect(frames.size).toBe(1);
        expect(container.querySelector('canvas')).toBe(canvas);
        await visibility(true);
        expect(frames.size).toBe(0);
        await visibility(false);
        expect(frames.size).toBe(1);
    });

    it('M15 initially hidden never starts, including with a visible intersection', async () => {
        hidden = true;
        await render();
        await intersect(true);
        expect(requestAnimationFrame).not.toHaveBeenCalled();
        expect(container.querySelector('[role="img"]')?.getAttribute('aria-label')).toMatch(/still/i);
    });

    it('M15 reduced motion never starts and changing preference cancels a live loop', async () => {
        preference.reduced = true;
        await render();
        await intersect(true);
        expect(requestAnimationFrame).not.toHaveBeenCalled();
        preference.reduced = false;
        await render();
        expect(frames.size).toBe(1);
        preference.reduced = true;
        await render();
        expect(frames.size).toBe(0);
        expect(container.querySelector('[role="img"]')?.getAttribute('aria-label')).toMatch(/still|rest|calm/i);
    });

    it('M15 the run cap settles to a labelled still and visibility or eye updates cannot restart it', async () => {
        await render();
        await intersect(true);
        await act(async () => vi.advanceTimersByTime(CREATURE_RUN_CAP_MS - 1));
        expect(frames.size).toBe(1);
        await act(async () => vi.advanceTimersByTime(1));
        expect(frames.size).toBe(0);
        expect(container.querySelector('[role="img"]')?.getAttribute('aria-label')).toMatch(/still|rest/i);
        await visibility(true);
        await visibility(false);
        await render({ redEyes: 3 });
        expect(frames.size).toBe(0);
        await render({ mode: 'rest' });
        await render();
        expect(frames.size).toBe(1);
    });

    it('M15 working and burst share a continuous run cap instead of extending an active loop', async () => {
        await render();
        await intersect(true);
        await act(async () => vi.advanceTimersByTime(1000));
        await render({ mode: 'burst' });
        await act(async () => vi.advanceTimersByTime(3000));
        await render({ mode: 'working' });
        await act(async () => vi.advanceTimersByTime(1000));
        expect(frames.size).toBe(0);
    });

    it('R1 burst after the working cap is spent still moves for a new request', async () => {
        await render();
        await intersect(true);
        await act(async () => vi.advanceTimersByTime(CREATURE_RUN_CAP_MS));
        expect(frames.size).toBe(0);
        await render({ mode: 'burst' });
        expect(frames.size).toBe(1);
        await act(async () => vi.advanceTimersByTime(CREATURE_BURST_MS - 1));
        expect(frames.size).toBe(1);
        await act(async () => vi.advanceTimersByTime(1));
        expect(frames.size).toBe(0);
    });

    it('R4 burst label does not stick when the timer fires 1 ms before the deadline', async () => {
        const input = { coordinator: 'idle', waitingCount: 0, requests: [], unloadedSessionIds: [] } satisfies Omit<CreatureModeInput, 'nowMs'>;
        function Probe({ value }: { value: Omit<CreatureModeInput, 'nowMs'> }) { return <output>{useCreatureMode(value)}</output>; }
        await act(async () => root.render(<Probe value={input} />));
        const real = Date.now.bind(Date);
        let skew = 0;
        vi.spyOn(Date, 'now').mockImplementation(() => real() - skew);
        await act(async () => root.render(<Probe value={{ ...input, waitingCount: 1, requests: [{ sessionId: 'worker', requestId: 'new' }] }} />));
        expect(container.textContent).toBe('burst');
        skew = 1;
        await act(async () => vi.advanceTimersByTime(CREATURE_BURST_MS));
        await act(async () => vi.advanceTimersByTime(10000));
        expect(container.textContent).toBe('rest');
    });

    it('F1 a burst while paused gets a full burst budget when less than 3 s remained', async () => {
        await render();
        await intersect(true);
        await act(async () => vi.advanceTimersByTime(CREATURE_RUN_CAP_MS - 500));
        await intersect(false);
        await render({ mode: 'burst' });
        expect(frames.size).toBe(0);
        await intersect(true);
        await act(async () => vi.advanceTimersByTime(CREATURE_BURST_MS - 1));
        expect(frames.size).toBe(1);
        await act(async () => vi.advanceTimersByTime(1));
        expect(frames.size).toBe(0);
    });

    it('M13 remount with an existing request establishes a baseline without replaying its burst', async () => {
        const input = { coordinator: 'idle', waitingCount: 0, requests: [], unloadedSessionIds: [] } satisfies Omit<CreatureModeInput, 'nowMs'>;
        function Probe({ value }: { value: Omit<CreatureModeInput, 'nowMs'> }) { return <output>{useCreatureMode(value)}</output>; }
        await act(async () => root.render(<Probe value={input} />));
        const waiting = { ...input, waitingCount: 1, requests: [{ sessionId: 'worker', requestId: 'new' }] };
        await act(async () => root.render(<Probe value={waiting} />));
        expect(container.textContent).toBe('burst');
        await act(async () => root.render(null));
        await act(async () => root.render(<Probe value={waiting} />));
        expect(container.textContent).toBe('rest');
        expect(vi.getTimerCount()).toBe(0);
    });

    it('M15 unmount removes the canvas and the engine visibility listener', async () => {
        const added = vi.spyOn(document, 'addEventListener');
        const removed = vi.spyOn(document, 'removeEventListener');
        await render();
        await intersect(true);
        const canvas = container.querySelector('canvas');
        const host = container.querySelector('[data-testid="ip-creature"]');
        const listeners = added.mock.calls.filter(([event]) => event === 'visibilitychange').map(([, listener]) => listener);
        expect(listeners).toHaveLength(2);
        await act(async () => root.render(null));
        expect(canvas?.parentNode).toBeNull();
        expect(host?.querySelector('canvas')).toBeNull();
        for (const listener of listeners) expect(removed).toHaveBeenCalledWith('visibilitychange', listener);
        expect(frames.size).toBe(0);
        expect(observers.size).toBe(0);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('M15 a second mount holds a still, and unmount releases the one-instance guard', async () => {
        await render({}, true);
        await intersect(true);
        expect(container.querySelectorAll('canvas')).toHaveLength(2);
        expect(frames.size).toBe(1);
        await act(async () => root.render(null));
        expect(frames.size).toBe(0);
        await render();
        await intersect(true);
        expect(frames.size).toBe(1);
    });
});
