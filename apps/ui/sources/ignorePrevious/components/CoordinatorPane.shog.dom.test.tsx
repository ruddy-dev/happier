/** @vitest-environment jsdom */
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { storage } from '@/sync/domains/state/storage';
import { createSessionFixture } from '@/dev/testkit/fixtures/sessionFixtures';
import { CoordinatorPane } from './CoordinatorPane';
import { deskPrefs } from '../deskPrefs';

// Browser hosts are the boundary under test for real keyboard focus.
vi.mock('react-native', async () => vi.importActual('react-native-web'));
vi.mock('@/hooks/ui/useReducedMotionPreference', async () => {
    const { createReducedMotionModuleMock } = await import('@/dev/testkit/mocks/reducedMotion');
    return createReducedMotionModuleMock(true);
});
vi.mock('@react-navigation/native', async () => {
    const { createReactNavigationNativeMock } = await import('@/dev/testkit/mocks/reactNavigation');
    return createReactNavigationNativeMock();
});
// The full transcript and record hydration cross the socket/network boundary.
vi.mock('@/components/sessions/shell/SessionView', async () => {
    const { deskScreenMocks } = await import('../testkit/deskScreenMocks');
    return deskScreenMocks.sessionView();
});
vi.mock('@/hooks/session/useHydrateSessionForRoute', async () => {
    const { deskScreenMocks } = await import('../testkit/deskScreenMocks');
    return deskScreenMocks.hydrateSessionForRoute();
});
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
let previous: ReturnType<typeof storage.getState>;
beforeEach(() => {
    previous = storage.getState();
    deskPrefs.set('creatureEnabled', true);
    storage.getState().applySessions([createSessionFixture({ id: 'coord', active: true, activeAt: Date.now() })]);
    storage.getState().applyReady();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
});
afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    storage.setState(previous, true);
});
function element(id: string) {
    const found = container.querySelector<HTMLElement>(`[data-testid="${id}"]`);
    expect(found, id).not.toBeNull();
    return found!;
}
async function click(id: string) {
    await act(async () => { element(id).focus(); element(id).click(); });
}
it('M13 mask opens the panel, Escape returns focus to that mask, and no Expand control exists', async () => {
    await act(async () => root.render(<SafeAreaInsetsContext.Provider value={{ top: 0, left: 0, right: 0, bottom: 0 }}>
        <CoordinatorPane sessionId="coord" />
    </SafeAreaInsetsContext.Provider>));
    const opener = element('ip-shog-open');
    expect([...container.querySelectorAll('[role="button"],button')].some(node => /expand/i.test(`${node.textContent} ${node.getAttribute('aria-label')}`))).toBe(false);
    await click('ip-shog-open');
    expect(element('ip-shog')).toBeTruthy();
    expect(opener.getAttribute('aria-expanded')).toBe('true');
    element('ip-shog-done').focus();
    await act(async () => document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(container.querySelector('[data-testid="ip-shog"]')).toBeNull();
    expect(document.activeElement).toBe(opener);
    expect(opener.getAttribute('aria-expanded')).toBe('false');
    await click('ip-shog-open');
    await click('ip-shog-done');
    expect(document.activeElement).toBe(opener);
    // Mockup 12 also makes the bare creature clickable; the mask owns keyboard focus.
    await click('ip-creature');
    expect(container.querySelector('[data-testid="ip-shog"]')).not.toBeNull();
    await click('ip-shog-done');
    expect(document.activeElement).toBe(opener);
});

it('M13 bare creature remains a pointer target without a keyboard stop or named button', async () => {
    await act(async () => root.render(<SafeAreaInsetsContext.Provider value={{ top: 0, left: 0, right: 0, bottom: 0 }}>
        <CoordinatorPane sessionId="coord" />
    </SafeAreaInsetsContext.Provider>));
    const creature = element('ip-creature');
    const pointerOpener = creature.parentElement!;
    expect(pointerOpener.tabIndex).toBe(-1);
    expect(creature.closest('button,[role="button"]')).toBeNull();
    expect(pointerOpener.hasAttribute('aria-label')).toBe(false);
    expect(pointerOpener.hasAttribute('aria-labelledby')).toBe(false);
    await act(async () => creature.click());
    expect(element('ip-shog')).toBeTruthy();
});

it('M13 clicking the bare creature while open closes the panel and returns focus to the mask', async () => {
    await act(async () => root.render(<SafeAreaInsetsContext.Provider value={{ top: 0, left: 0, right: 0, bottom: 0 }}>
        <CoordinatorPane sessionId="coord" />
    </SafeAreaInsetsContext.Provider>));
    const opener = element('ip-shog-open');
    const creature = element('ip-creature');
    await click('ip-shog-open');
    await act(async () => element('ip-shog-done').focus());
    await act(async () => creature.click());
    expect(container.querySelector('[data-testid="ip-shog"]')).toBeNull();
    expect(document.activeElement).toBe(opener);
});

it('M13 mask identifies the open panel with aria-controls', async () => {
    await act(async () => root.render(<SafeAreaInsetsContext.Provider value={{ top: 0, left: 0, right: 0, bottom: 0 }}>
        <CoordinatorPane sessionId="coord" />
    </SafeAreaInsetsContext.Provider>));
    await click('ip-shog-open');
    const panel = element('ip-shog');
    expect(panel.id).not.toBe('');
    expect(element('ip-shog-open').getAttribute('aria-controls')).toBe(panel.id);
});
