/** @vitest-environment jsdom */
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { DeskTopBar } from './DeskTopBar';

// Real web hosts exercise the upstream portal, pointer propagation and focus.
vi.mock('react-native', async () => vi.importActual('react-native-web'));
vi.mock('@/hooks/ui/useReducedMotionPreference', async () => {
    const { createReducedMotionModuleMock } = await import('@/dev/testkit/mocks/reducedMotion');
    return createReducedMotionModuleMock(true);
});
// These modules must never enter the desk usage path, even while it is closed.
vi.mock('@/hooks/server/connectedServices/useConnectedServiceQuotaSnapshot', () => {
    throw new Error('M12: desk usage must not import connected-service quota snapshots');
});
vi.mock('@/hooks/server/connectedServices/useConnectedServiceQuotaBadges', () => {
    throw new Error('M12: desk usage must not import connected-service quota badges');
});
vi.mock('@/hooks/server/connectedServices/useConnectedServiceQuotaSnapshots', () => {
    throw new Error('M12: desk usage must not import connected-service quota snapshots');
});
vi.mock('@/hooks/server/connectedServices/useProviderAccountUsageSnapshots', () => {
    throw new Error('M12: desk usage must not import provider account usage');
});

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
const outsideAction = vi.fn();
beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
});
afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
});
async function render(phone = false) {
    vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(phone ? 390 : 1440);
    await act(async () => window.dispatchEvent(new Event('resize')));
    await act(async () => root.render(
        <SafeAreaInsetsContext.Provider value={{ top: 0, right: 0, bottom: 0, left: 0 }}>
            <DeskTopBar phone={phone} sessionsRef={{ current: null }} onSessions={() => {}} waiting={null} settings={null} />
            <button data-testid="outside-action" onClick={outsideAction}>Other action</button>
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
it.each(['close', 'escape', 'outside'] as const)('M12: %s closes usage and returns focus to Usage', async method => {
    await render();
    await click('ip-top-usage');
    element('ip-usage-close').focus();
    if (method === 'close') await click('ip-usage-close');
    if (method === 'escape') await act(async () => {
        document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    if (method === 'outside') {
        await click('outside-action');
        expect(outsideAction).toHaveBeenCalledOnce();
    }
    expect(document.querySelector('[data-testid="ip-usage-popover"]')).toBeNull();
    expect(element('ip-top-usage').getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(element('ip-top-usage'));
});
