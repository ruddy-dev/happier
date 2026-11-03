/** @vitest-environment jsdom */
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { FocusReturnProvider, useFocusReturnFallbackRef } from '@/keyboard/focusReturn';
import { DeskTopBar } from './DeskTopBar';
import { DeskUsageButton } from './DeskUsageButton';
import type { DeskUsageInput } from '../model/deskUsage';
import type { TerminalPalette } from '../palette';
import { deskPrefs, type ChatStyle } from '../deskPrefs';

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
let previousChatStyle: ChatStyle;
let previousPalette: TerminalPalette;
const outsideAction = vi.fn();
beforeEach(() => {
    previousChatStyle = deskPrefs.get('chatStyle');
    previousPalette = deskPrefs.get('terminalPalette');
    // Import-factory calls happen during collection; retain them for the named guard.
    outsideAction.mockClear();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
});
afterEach(async () => {
    await act(async () => root.unmount());
    deskPrefs.set('chatStyle', previousChatStyle);
    deskPrefs.set('terminalPalette', previousPalette);
    container.remove();
    vi.restoreAllMocks();
});
function Fallback() {
    const ref = useFocusReturnFallbackRef<HTMLButtonElement | null>();
    return <button ref={ref} data-testid="fallback">Fallback</button>;
}
async function render(phone = false, showBar = true) {
    await renderContent(showBar ? <DeskTopBar phone={phone} sessionsRef={{ current: null }} onSessions={() => {}} waiting={null} settings={() => null} /> : null, phone);
}
async function renderContent(content: React.ReactNode, phone = false) {
    vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(phone ? 390 : 1440);
    await act(async () => window.dispatchEvent(new Event('resize')));
    await act(async () => root.render(
        <SafeAreaInsetsContext.Provider value={{ top: 0, right: 0, bottom: 0, left: 0 }}>
            <FocusReturnProvider>
                {content}
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
    expect(button.textContent).toBe(phone ? 'Usage' : 'UsageNot available');
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
it.each(['terminal', 'mask'] as const)('R41: %s keeps the desktop brand and honest inline usage visible', async style => {
    deskPrefs.set('chatStyle', style);
    await render();
    expect(element('ip-top-brand').textContent).toContain('Ignore Previous');
    expect(element('ip-top-brand-mask').getAttribute('aria-hidden')).toBe('true');
    expect(element('ip-top-usage-inline').textContent).toBe('Not available');
    expect(element('ip-top-usage').textContent).not.toMatch(/[\d%]/);
    await click('ip-top-usage');
    expect(element('ip-usage-reason').textContent).toContain("Usage isn't connected");
});
// Input-boundary examples only. No ambient desk fixture or provider/profile record
// establishes the exact Max account, so none is adapted into these percentages.
it.each(['terminal', 'mask'] as const)('R41: %s renders scoped known values and zero, then rejects old source/account data', async style => {
    deskPrefs.set('chatStyle', style);
    const scope = { sourceId: 'synthetic-authority', accountId: 'synthetic-max-account' };
    const snapshot = { scope, maxWeek: 0, lastFiveHours: 63, fableShare: 12 };
    const renderInput = (usage: DeskUsageInput) => renderContent(<DeskUsageButton usage={usage} />);
    await renderInput({ scope, snapshot });
    const button = element('ip-top-usage');
    expect(button.getAttribute('role')).toBe('button');
    expect(button.getAttribute('aria-label')).toBe('Usage: Max week 0%');
    expect(element('ip-top-usage-inline').textContent).toBe('Max week 0%');
    await click('ip-top-usage');
    const popover = element('ip-usage-popover');
    expect(popover.getAttribute('role')).toBe('dialog');
    expect(popover.getAttribute('aria-label')).toBe('Usage');
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(popover.contains(document.activeElement)).toBe(true);
    expect(element('ip-usage-row-maxWeek').textContent).toBe('Max week0%');
    expect(element('ip-usage-row-lastFiveHours').textContent).toBe('Last five hours63%');
    expect(element('ip-usage-row-fableShare').textContent).toBe('Fable share (estimate)12%');
    expect(document.querySelector('[data-testid="ip-usage-reason"]')).toBeNull();

    // The open panel and inline status update together; an unknown is not zero.
    await renderInput({ scope, snapshot: { ...snapshot, maxWeek: null, fableShare: null } });
    expect(element('ip-top-usage-inline').textContent).toBe('Last five hours 63%');
    expect(button.getAttribute('aria-label')).toBe('Usage: Last five hours 63%');
    expect(element('ip-usage-row-maxWeek').textContent).toBe('Max weekNot available');
    expect(element('ip-usage-row-fableShare').textContent).toBe('Fable share (estimate)Not available');
    expect(element('ip-usage-reason').textContent).toBe("Some usage figures aren't available for this account.");

    for (const nextScope of [
        { ...scope, sourceId: 'synthetic-replacement-source' },
        { ...scope, accountId: 'synthetic-other-account' },
        null,
    ]) {
        await renderInput({ scope: nextScope, snapshot });
        expect(element('ip-top-usage')).toBe(button);
        expect(element('ip-usage-popover')).toBe(popover);
        expect(button.getAttribute('aria-label')).toBe('Usage: Not available');
        expect(element('ip-top-usage-inline').textContent).toBe('Not available');
        expect([...popover.querySelectorAll('[data-testid^="ip-usage-row-"]')].every(row => row.textContent?.endsWith('Not available'))).toBe(true);
        expect(popover.textContent).not.toMatch(/[\d%]/);
        expect(element('ip-usage-reason').textContent).toContain("Usage isn't connected");
    }
    await renderInput({ scope, snapshot: null });
    expect(element('ip-top-usage-inline').textContent).toBe('Not available');
    await act(async () => document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(document.querySelector('[data-testid="ip-usage-popover"]')).toBeNull();
    expect(document.activeElement).toBe(button);
});
it.each(['terminal', 'mask'] as const)('R41: %s phone paints qualified supplied values and withdraws them with the open panel', async style => {
    deskPrefs.set('chatStyle', style);
    const scope = { sourceId: 'synthetic-authority', accountId: 'synthetic-max-account' };
    const snapshot = { scope, maxWeek: 38, lastFiveHours: 63, fableShare: 12 };
    const renderInput = (usage?: DeskUsageInput) => renderContent(<DeskUsageButton phone usage={usage} />, true);
    await renderInput({ scope, snapshot });
    const button = element('ip-top-usage');
    expect(button.textContent).toBe('Max 38%');
    expect(element('ip-top-usage-inline').textContent).toBe('Max 38%');
    expect(button.getAttribute('aria-label')).toBe('Usage: Max week 38%');
    await click('ip-top-usage');
    const panel = element('ip-usage-popover');
    expect(element('ip-usage-row-maxWeek').textContent).toBe('Max week38%');
    // A real zero remains known. Other windows keep their own compact labels,
    // and Fable retains a visible estimate qualifier as well as its full name.
    for (const [values, inline, status, panelText] of [
        [{ maxWeek: 0, lastFiveHours: null, fableShare: null }, 'Max 0%', 'Max week 0%', 'Max week0%'],
        [{ maxWeek: 100, lastFiveHours: null, fableShare: null }, 'Max 100%', 'Max week 100%', 'Max week100%'],
        [{ maxWeek: null, lastFiveHours: 0, fableShare: null }, '5h 0%', 'Last five hours 0%', 'Last five hours0%'],
        [{ maxWeek: null, lastFiveHours: 63, fableShare: null }, '5h 63%', 'Last five hours 63%', 'Last five hours63%'],
        [{ maxWeek: null, lastFiveHours: 100, fableShare: null }, '5h 100%', 'Last five hours 100%', 'Last five hours100%'],
        [{ maxWeek: null, lastFiveHours: null, fableShare: 0 }, 'Fable\nest. 0%', 'Fable share (estimate) 0%', 'Fable share (estimate)0%'],
        [{ maxWeek: null, lastFiveHours: null, fableShare: 12 }, 'Fable\nest. 12%', 'Fable share (estimate) 12%', 'Fable share (estimate)12%'],
        [{ maxWeek: null, lastFiveHours: null, fableShare: 100 }, 'Fable\nest. 100%', 'Fable share (estimate) 100%', 'Fable share (estimate)100%'],
    ] as const) {
        await renderInput({ scope, snapshot: { scope, ...values } });
        expect(button.textContent).toBe(inline);
        expect(element('ip-top-usage-inline').textContent).toBe(inline);
        expect(button.getAttribute('aria-label')).toBe(`Usage: ${status}`);
        expect(panel.textContent).toContain(panelText);
        expect(button.getAttribute('aria-expanded')).toBe('true');
    }
    for (const usage of [
        { scope, snapshot: { ...snapshot, maxWeek: null, lastFiveHours: null, fableShare: null } },
        { scope: { ...scope, sourceId: 'synthetic-other-source' }, snapshot },
        { scope: { ...scope, accountId: 'synthetic-other-account' }, snapshot },
        { scope: null, snapshot },
        { scope, snapshot: null },
        undefined,
    ]) {
        // Restore the widest qualified phone reading before every withdrawal.
        // This checks text/scope lifecycle only; browser QA owns flex geometry.
        await renderInput({ scope, snapshot: { ...snapshot, maxWeek: null, lastFiveHours: null, fableShare: 100 } });
        expect(button.textContent).toBe('Fable\nest. 100%');
        await renderInput(usage);
        expect(element('ip-top-usage')).toBe(button);
        expect(element('ip-usage-popover')).toBe(panel);
        expect(button.textContent).toBe('Usage');
        expect(document.querySelector('[data-testid="ip-top-usage-inline"]')).toBeNull();
        expect(button.getAttribute('aria-label')).toBe('Usage: Not available');
        expect([...panel.querySelectorAll('[data-testid^="ip-usage-row-"]')].every(row => row.textContent?.endsWith('Not available'))).toBe(true);
        expect(panel.textContent).not.toMatch(/[\d%]/);
    }
    await click('ip-usage-close');
    expect(document.activeElement).toBe(button);
});
it.each([
    ['terminal', false, 'close'], ['terminal', true, 'escape'],
    ['mask', false, 'escape'], ['mask', true, 'close'],
] as const)('M12: %s phone=%s %s closes usage and returns focus to Usage', async (style, phone, method) => {
    deskPrefs.set('chatStyle', style);
    await render(phone);
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
it('R59/R60: changing the Terminal palette keeps the named open dialog and Close focus', async () => {
    deskPrefs.set('chatStyle', 'terminal');
    deskPrefs.set('terminalPalette', 'tokyo');
    await render(true);
    await click('ip-top-usage');
    const dialog = element('ip-usage-popover');
    const close = element('ip-usage-close');
    expect(dialog.getAttribute('role')).toBe('dialog');
    expect(dialog.getAttribute('aria-label')).toBe('Usage');
    expect(document.activeElement).toBe(close);
    for (const palette of ['kanagawa', 'gruvbox', 'dracula', 'terminalPaper', 'tokyo'] as const) {
        await act(async () => deskPrefs.set('terminalPalette', palette));
        expect(element('ip-usage-popover')).toBe(dialog);
        expect(element('ip-usage-close')).toBe(close);
        expect(document.activeElement).toBe(close);
        expect(element('ip-top-usage').getAttribute('aria-expanded')).toBe('true');
        expect(dialog.textContent).not.toMatch(/[\d%]/);
    }
    await click('ip-usage-close');
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
