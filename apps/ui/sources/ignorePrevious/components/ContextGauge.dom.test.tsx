/** @vitest-environment jsdom */
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createSessionFixture } from '@/dev/testkit/fixtures/sessionFixtures';
import { sessionContextMeter } from './ContextMeter';
import { ContextGauge } from './ContextGauge';
import { useIpColours } from '../palette';

// Real web hosts and the real popup owner exercise focus and pointer transitions.
vi.mock('react-native', async () => vi.importActual('react-native-web'));
vi.mock('@/hooks/ui/useReducedMotionPreference', async () => {
    const { createReducedMotionModuleMock } = await import('@/dev/testkit/mocks/reducedMotion');
    return createReducedMotionModuleMock(true);
});
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
    vi.stubEnv('EXPO_PUBLIC_IP_AUTOCOMPACT_CLAUDE', '220000');
    container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllEnvs(); });
function session(used: number | null) {
    const base = createSessionFixture();
    return createSessionFixture({
        metadata: { ...base.metadata!, flavor: 'claude' },
        latestUsage: used === null ? null : {
            inputTokens: 0, outputTokens: 0, cacheCreation: 0, cacheRead: 0,
            contextSize: used, contextSizeIsReported: true, contextWindowTokens: 1_000_000, timestamp: 1,
        },
    });
}
async function render(used: number | null = 95_500) {
    await act(async () => root.render(<SafeAreaInsetsContext.Provider value={{ top: 0, right: 0, bottom: 0, left: 0 }}>
        <ContextGauge session={session(used)} /><button data-testid="outside">Outside</button>
    </SafeAreaInsetsContext.Provider>));
}
function element(id: string) {
    const found = document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
    expect(found, id).not.toBeNull(); return found!;
}
const popup = () => document.querySelector('[data-testid="ip-context-popover"]');
async function hover(target: HTMLElement, relatedTarget: HTMLElement | null = null) {
    await act(async () => target.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget })));
}
async function leave(target: HTMLElement, relatedTarget: HTMLElement = document.body) {
    await act(async () => target.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget })));
}
async function escape() {
    await act(async () => document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
}
it.each([[95_500, 43, '95.5k'], [209_000, 95, '209k'], [242_000, 110, '242k']])(
    'C9 L11 displays the owner percentage for %i tokens and bounds only the bar', async (used, percent, count) => {
        await render(used);
        const meter = sessionContextMeter(session(used))!;
        expect(element('ip-context-gauge').getAttribute('role')).toBe('button');
        expect(element('ip-context-gauge').getAttribute('aria-label')).toContain(`${percent}%`);
        expect(element('ip-context-gauge').getAttribute('aria-label')).toContain(`${count} of 220k before auto-compact`);
        expect(element('ip-context-gauge-fill').style.width).toBe(`${meter.ratio * 100}%`);
        await hover(element('ip-context-gauge'));
        expect(popup()?.textContent).toContain(`${count} of 220k before auto-compact`);
        expect(popup()?.textContent).toContain('1M');
        expect(popup()?.textContent).toContain('EXPO_PUBLIC_IP_AUTOCOMPACT_CLAUDE');
        expect(element('ip-context-announcement').getAttribute('aria-live')).toBe('polite');
    },
);
it('C9 shows window-only numbers and no gauge before any report', async () => {
    vi.stubEnv('EXPO_PUBLIC_IP_AUTOCOMPACT_CLAUDE', '');
    await render(); await hover(element('ip-context-gauge'));
    expect(popup()?.textContent).toContain('95.5k of 1M of the window');
    await render(null);
    expect(document.querySelector('[data-testid="ip-context-gauge"]')).toBeNull();
    expect(popup()).toBeNull();
});
it('C9 hover opens, leaving closes, and moving into the popover keeps it readable', async () => {
    await render(); const gauge = element('ip-context-gauge');
    await hover(gauge); expect(popup()).not.toBeNull();
    await leave(gauge, element('ip-context-popover')); expect(popup()).not.toBeNull();
    await leave(element('ip-context-popover')); expect(popup()).toBeNull();
    await hover(gauge); await leave(gauge); expect(popup()).toBeNull();
});
it('C9 focus opens, blur closes, and Escape hides without reopening on returned focus', async () => {
    await render(); const gauge = element('ip-context-gauge');
    await act(async () => gauge.focus()); expect(popup()).not.toBeNull();
    await act(async () => element('outside').focus()); expect(popup()).toBeNull();
    await act(async () => gauge.focus()); await escape();
    expect(popup()).toBeNull(); expect(document.activeElement).toBe(gauge);
});
it('Finding 2 C9 click pins through pointer leave and blur; outside controls keep focus and Escape returns it', async () => {
    await render(); const gauge = element('ip-context-gauge');
    await hover(gauge); await act(async () => { gauge.focus(); gauge.click(); });
    await leave(gauge); await act(async () => element('outside').focus());
    expect(popup()).not.toBeNull();
    await act(async () => element('outside').click());
    expect(popup()).toBeNull(); expect(document.activeElement).toBe(element('outside'));
    await act(async () => gauge.click()); expect(popup()).not.toBeNull();
    await escape(); expect(popup()).toBeNull(); expect(document.activeElement).toBe(gauge);
});

it('Finding 1 mouse pin then unpin does not leave later hover previews stuck', async () => {
    await render(); const gauge = element('ip-context-gauge');
    await hover(gauge);
    await act(async () => {
        gauge.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        gauge.focus(); gauge.click();
    });
    await act(async () => gauge.click());
    await leave(gauge);
    await hover(gauge); expect(popup()).not.toBeNull();
    await leave(gauge); expect(popup()).toBeNull();
});
it('Finding 1 keyboard focus keeps its preview through pointer leave', async () => {
    await render(); const gauge = element('ip-context-gauge');
    await act(async () => gauge.focus());
    await hover(gauge); await leave(gauge);
    expect(popup()).not.toBeNull();
    await escape(); expect(popup()).toBeNull();
});
it('Finding 2 toggle returns focus and outside non-focusable space returns lost focus', async () => {
    await render(); const gauge = element('ip-context-gauge');
    await act(async () => gauge.click());
    await act(async () => element('outside').focus());
    await act(async () => gauge.click());
    expect(popup()).toBeNull(); expect(document.activeElement).toBe(gauge);
    await act(async () => gauge.click());
    await act(async () => {
        gauge.blur();
        document.body.click();
    });
    expect(popup()).toBeNull(); expect(document.activeElement).toBe(gauge);
});
it.each([[95_500, 'yellow'], [197_800, 'red'], [209_000, 'red']] as const)(
    'Finding 3 uses the displayed percentage for the signal colour at %i', async (used, signal) => {
        function PaletteProbe() {
            const colours = useIpColours();
            return <span data-testid="expected-colour" style={{ backgroundColor: colours[signal] }} />;
        }
        await act(async () => root.render(<SafeAreaInsetsContext.Provider value={{ top: 0, right: 0, bottom: 0, left: 0 }}>
            <ContextGauge session={session(used)} /><PaletteProbe />
        </SafeAreaInsetsContext.Provider>));
        expect(element('ip-context-gauge-fill').style.backgroundColor).toBe(element('expected-colour').style.backgroundColor);
    },
);
it('Finding 5 mounts an empty polite region before opening and updates that same region with the popover text', async () => {
    await render();
    const region = element('ip-context-announcement');
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.textContent).toBe('');
    await hover(element('ip-context-gauge'));
    expect(element('ip-context-announcement')).toBe(region);
    expect(region.textContent).toContain('95.5k of 220k before auto-compact');
    expect(region.textContent).toContain('1M');
    expect(region.textContent).toContain('EXPO_PUBLIC_IP_AUTOCOMPACT_CLAUDE');
    await leave(element('ip-context-gauge'));
    expect(region.textContent).toBe('');
});
