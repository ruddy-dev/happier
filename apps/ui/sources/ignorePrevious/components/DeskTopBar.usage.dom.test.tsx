/** @vitest-environment jsdom */
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { FocusReturnProvider, useFocusReturnFallbackRef } from '@/keyboard/focusReturn';
import { DeskTopBar } from './DeskTopBar';

// Real web hosts exercise the upstream portal, pointer propagation and focus.
vi.mock('react-native', async () => vi.importActual('react-native-web'));
vi.mock('@/hooks/ui/useReducedMotionPreference', async () => {
    const { createReducedMotionModuleMock } = await import('@/dev/testkit/mocks/reducedMotion');
    return createReducedMotionModuleMock(true);
});
// These modules must never enter the desk usage path, even while it is closed.
const { forbiddenUsageModule } = vi.hoisted(() => ({ forbiddenUsageModule: vi.fn() }));
vi.mock('@/hooks/server/connectedServices/useConnectedServiceQuotaSnapshot', () => {
    forbiddenUsageModule('quota snapshot');
    return { useConnectedServiceQuotaSnapshot: forbiddenUsageModule };
});
vi.mock('@/hooks/server/connectedServices/useConnectedServiceQuotaBadges', () => {
    forbiddenUsageModule('quota badges');
    return { useConnectedServiceQuotaBadges: forbiddenUsageModule };
});
vi.mock('@/hooks/server/connectedServices/useConnectedServiceQuotaSnapshots', () => {
    forbiddenUsageModule('quota snapshots');
    return { useConnectedServiceQuotaSnapshots: forbiddenUsageModule };
});
vi.mock('@/hooks/server/connectedServices/useProviderAccountUsageSnapshots', () => {
    forbiddenUsageModule('provider account usage');
    return { useProviderAccountUsageSnapshots: forbiddenUsageModule };
});

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
const outsideAction = vi.fn();
beforeEach(() => {
    // Import-factory calls happen during collection; retain them for the named guard.
    outsideAction.mockClear();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
});
afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
});
function Fallback() {
    const ref = useFocusReturnFallbackRef<HTMLButtonElement | null>();
    return <button ref={ref} data-testid="fallback">Fallback</button>;
}
async function render(phone = false, showBar = true) {
    vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(phone ? 390 : 1440);
    await act(async () => window.dispatchEvent(new Event('resize')));
    await act(async () => root.render(
        <SafeAreaInsetsContext.Provider value={{ top: 0, right: 0, bottom: 0, left: 0 }}>
            <FocusReturnProvider>
                {showBar && <DeskTopBar phone={phone} sessionsRef={{ current: null }} onSessions={() => {}} waiting={null} settings={null} />}
                <button data-testid="outside-action" onClick={outsideAction}>Other action</button>
                <input data-testid="outside-input" />
                <div data-testid="outside-area">Outside area</div>
                <Fallback />
            </FocusReturnProvider>
        </SafeAreaInsetsContext.Provider>,
    ));
}
function element(id: string) {
    const node = document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
    expect(node, id).not.toBeNull();
    return node!;
}
async function click(id: string) {
    await act(async () => {
        element(id).focus();
        element(id).click();
    });
}
it.each([false, true])('M12: Usage opens honest non-modal rows, phone=%s', async phone => {
    await render(phone);
    const button = element('ip-top-usage');
    expect(button.textContent).toBe('Usage');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(document.querySelector('[data-testid="ip-usage-popover"]')).toBeNull();
    await click('ip-top-usage');
    const popover = element('ip-usage-popover');
    expect(popover.getAttribute('role')).toBe('dialog');
    expect(document.querySelector('[aria-modal="true"]')).toBeNull();
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(popover.contains(document.activeElement)).toBe(true);
    expect([...popover.querySelectorAll('[data-testid^="ip-usage-row-"]')].map(row => row.textContent)).toEqual([
        'Max weekNot available', 'Last five hoursNot available', 'Fable share (estimate)Not available',
    ]);
    expect(element('ip-usage-reason').textContent).toBe("Usage isn't connected to this desk yet, so no figures are shown.");
    expect(popover.textContent).not.toMatch(/[\d%]/);
    await click('ip-top-usage');
    expect(document.querySelector('[data-testid="ip-usage-popover"]')).toBeNull();
    expect(button.getAttribute('aria-expanded')).toBe('false');
});
it.each(['close', 'escape'] as const)('M12: %s closes usage and returns focus to Usage', async method => {
    await render();
    await click('ip-top-usage');
    element('ip-usage-close').focus();
    if (method === 'close') await click('ip-usage-close');
    if (method === 'escape') await act(async () => {
        document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(document.querySelector('[data-testid="ip-usage-popover"]')).toBeNull();
    expect(element('ip-top-usage').getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(element('ip-top-usage'));
});
it('M12: outside input keeps focus and accepts typing after Usage closes', async () => {
    await render();
    await click('ip-top-usage');
    await click('outside-input');
    expect(document.querySelector('[data-testid="ip-usage-popover"]')).toBeNull();
    expect(element('ip-top-usage').getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(element('outside-input'));
    // jsdom has no text-entry default action; insert into the actual focused input.
    const focused = document.activeElement;
    if (!(focused instanceof HTMLInputElement)) throw new Error('Expected focused input');
    await act(async () => {
        focused.setRangeText('hello');
        focused.dispatchEvent(new InputEvent('input', { data: 'hello', inputType: 'insertText', bubbles: true }));
    });
    expect(focused.value).toBe('hello');
});
it('M12: outside button keeps focus and receives its click after Usage closes', async () => {
    await render();
    await click('ip-top-usage');
    await click('outside-action');
    expect(document.querySelector('[data-testid="ip-usage-popover"]')).toBeNull();
    expect(outsideAction).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(element('outside-action'));
});
it('M12: outside non-focusable area closes Usage and recovers focus', async () => {
    await render();
    await click('ip-top-usage');
    await click('outside-area');
    expect(document.querySelector('[data-testid="ip-usage-popover"]')).toBeNull();
    expect(document.activeElement).toBe(element('ip-top-usage'));
});
it('M12: unmount with a registered fallback preserves focus on a sibling input', async () => {
    await render();
    await click('ip-top-usage');
    element('outside-input').focus();
    await render(false, false);
    expect(document.querySelector('[data-testid="ip-top-usage"]')).toBeNull();
    expect(document.querySelector('[data-testid="ip-usage-popover"]')).toBeNull();
    expect(document.activeElement).toBe(element('outside-input'));
});
it('M12: unmount while focus is inside Usage recovers to the registered fallback', async () => {
    await render();
    await click('ip-top-usage');
    expect(element('ip-usage-popover').contains(document.activeElement)).toBe(true);
    await render(false, false);
    expect(document.activeElement).toBe(element('fallback'));
});
it('M12: Usage never imports or calls connected-services or quota modules', async () => {
    await render();
    expect(forbiddenUsageModule).not.toHaveBeenCalled();
    await click('ip-top-usage');
    await click('ip-usage-close');
    expect(forbiddenUsageModule).not.toHaveBeenCalled();
});
