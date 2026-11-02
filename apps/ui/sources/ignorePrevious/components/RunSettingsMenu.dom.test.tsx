/** @vitest-environment jsdom */
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { RunSettingsMenu } from './RunSettingsMenu';

// Real web hosts exercise menu roles, focus and the shared popup lifecycle.
vi.mock('react-native', async () => vi.importActual('react-native-web'));
vi.mock('@/hooks/ui/useReducedMotionPreference', async () => { const { createReducedMotionModuleMock } = await import('@/dev/testkit/mocks/reducedMotion'); return createReducedMotionModuleMock(true); });
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
beforeEach(() => { container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
async function render(midTurn = false) {
    await act(async () => root.render(<SafeAreaInsetsContext.Provider value={{ top: 0, right: 0, bottom: 0, left: 0 }}><RunSettingsMenu midTurn={midTurn} /></SafeAreaInsetsContext.Provider>));
}
function element(id: string) {
    const found = document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
    expect(found, id).not.toBeNull();
    return found!;
}
async function click(id: string) { await act(async () => { const target = element(id); target.focus(); target.click(); }); }
it('M9 picks keep the menu open, update the summary and clear Ultracode across model switches', async () => {
    await render();
    expect(element('ip-run-settings').textContent).toBe('Opus 5.5 · high · plans only');
    await click('ip-run-settings');
    await click('ip-run-ultracode');
    expect(element('ip-run-settings').textContent).toBe('Opus 5.5 · Ultracode · plans only');
    await click('ip-run-model-claude-haiku-5-5');
    expect(element('ip-run-menu').textContent).toContain('Only on Opus 5.5, Sonnet 5.5 and Fable 5.1.');
    await click('ip-run-model-claude-opus-5-5');
    expect(element('ip-run-ultracode').getAttribute('aria-checked')).toBe('false');
    await click('ip-run-model-default');
    expect(element('ip-run-settings').textContent).toContain('Default model');
});
it('M10 exposes radio and checkbox roles and locks effort at extra high under Ultracode', async () => {
    await render(); await click('ip-run-settings'); await click('ip-run-ultracode');
    expect(element('ip-run-menu').textContent).toContain('Effort: extra high, set by Ultracode');
    expect(element('ip-run-ultracode').getAttribute('role')).toBe('menuitemcheckbox');
    expect(element('ip-run-effort-low').getAttribute('role')).toBe('menuitemradio');
    expect(element('ip-run-effort-low').parentElement?.getAttribute('role')).toBe('group');
    expect(element('ip-run-model-default').parentElement?.getAttribute('role')).toBe('group');
    expect(element('ip-run-effort-low').getAttribute('aria-disabled')).toBe('true');
    expect(element('ip-run-effort-xhigh').getAttribute('aria-checked')).toBe('true');
});
it('M9 Escape closes and returns focus; an outside click also closes without swallowing the click', async () => {
    await render(); await click('ip-run-settings'); await click('ip-run-effort-medium');
    await act(async () => { document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(document.querySelector('[data-testid="ip-run-menu"]')).toBeNull();
    expect(document.activeElement).toBe(element('ip-run-settings'));
    await click('ip-run-settings');
    await act(async () => document.body.click());
    expect(document.querySelector('[data-testid="ip-run-menu"]')).toBeNull();
    expect(document.activeElement).toBe(element('ip-run-settings'));
});
it('M11 marks a mid-turn change as applying next turn and clears the note when idle', async () => {
    await render(true); await click('ip-run-settings');
    expect(document.querySelector('[data-testid="ip-run-next-turn"]')).toBeNull();
    await click('ip-run-effort-low');
    expect(element('ip-run-next-turn').textContent).toBe('applies next turn');
    await render(false);
    expect(document.querySelector('[data-testid="ip-run-next-turn"]')).toBeNull();
});

it.each(['claude-haiku-5-5', 'default'])('M3 offers catalog effort levels and preserves effort across %s', async (model) => {
    await render(); await click('ip-run-settings');
    const choices = () => [...document.querySelectorAll('[role="menuitemradio"][data-testid^="ip-run-effort-"]')].map(node => node.getAttribute('data-testid'));
    expect(choices()).toEqual(['low', 'medium', 'high', 'xhigh', 'max'].map(level => `ip-run-effort-${level}`));
    await click('ip-run-effort-medium');
    await click(`ip-run-model-${model}`);
    expect(choices()).toEqual([]);
    expect(element('ip-run-effort-group').getAttribute('aria-disabled')).toBe('true');
    expect(element('ip-run-effort-unavailable').textContent).toBeTruthy();
    await click('ip-run-model-claude-opus-5-5');
    expect(element('ip-run-effort-medium').getAttribute('aria-checked')).toBe('true');
    await click('ip-run-effort-max');
    expect(element('ip-run-effort-max').getAttribute('aria-checked')).toBe('true');
});
