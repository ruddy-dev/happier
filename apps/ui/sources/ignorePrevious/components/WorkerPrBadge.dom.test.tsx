/** @vitest-environment jsdom */
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi, type MockInstance } from 'vitest';

import { createSessionFixture } from '@/dev/testkit';
import { storage } from '@/sync/domains/state/storage';
import * as externalUrls from '@/utils/url/openExternalUrl';
import { installTauriExternalLinkClicks } from '@/utils/url/installTauriExternalLinkClicks';
import { prSnapshot } from '../testkit/prSnapshot';
import { WorkerPrBadge } from './WorkerPrBadge';

// Keep RN Web's real link, focus and event dispatch below the browser boundaries.
vi.mock('react-native', async () => vi.importActual('react-native-web'));
vi.mock('@react-navigation/native', async () => {
    const { createReactNavigationNativeMock } = await import('@/dev/testkit/mocks/reactNavigation');
    return createReactNavigationNativeMock();
});
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const url = 'https://example.invalid/example/project/pull/42';
const rejectedUrl = 'ftp://example.invalid/example/project/pull/42';
let previous: ReturnType<typeof storage.getState>;
let container: HTMLDivElement;
let root: Root;
let opened: MockInstance<typeof window.open>;
let removeTauriAdapter: (() => void) | undefined;

beforeEach(() => {
    previous = storage.getState();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    opened = vi.spyOn(window, 'open').mockReturnValue(null);
    storage.getState().applySessions([createSessionFixture({ id: 'badge-worker' })]);
});

afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    storage.setState(previous, true);
    removeTauriAdapter?.();
    removeTauriAdapter = undefined;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

async function renderBadge(snapshotUrl = url) {
    const snapshot = prSnapshot({ fetchedAt: Date.now() });
    snapshot.pullRequest = { ...snapshot.pullRequest!, url: snapshotUrl };
    storage.getState().updateSessionProjectScmSnapshot('badge-worker', snapshot);
    await act(async () => root.render(<WorkerPrBadge sessionId="badge-worker" />));
    return container.querySelector<HTMLElement>('[data-testid="ip-worker-pr-badge-worker"]')!;
}

async function dispatch(badge: HTMLElement, event: MouseEvent) {
    let prevented: boolean | undefined;
    // React dispatch runs first on this same root. Observe its native event before
    // cancelling JSDOM's default action: no test navigates or executes a URL.
    container.addEventListener(event.type, (received) => {
        prevented = received.defaultPrevented;
        received.preventDefault();
    }, { once: true });
    await act(async () => badge.dispatchEvent(event));
    expect(prevented).toBeDefined();
    return prevented;
}

it('gives the browser an actual PR link and opens an ordinary pointer click exactly once', async () => {
    const badge = await renderBadge();
    expect(badge.getAttribute('role')).toBe('link');
    expect(badge.getAttribute('aria-label')).toContain('PR #42');
    // RN Web delegates link Enter activation to the browser. J4 remains its gate.
    expect(badge.tagName).toBe('A');
    expect(badge.getAttribute('href')).toBe(url);
    await act(async () => badge.focus());
    expect(document.activeElement).toBe(badge);
    expect(badge.tabIndex).toBe(0);
    const click = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, detail: 1 });
    expect(await dispatch(badge, click)).toBe(true);
    expect(opened.mock.calls).toEqual([[url, '_blank', 'noopener,noreferrer']]);
});

const browserNavigationEvents = [
    { name: 'Ctrl-click', type: 'click', init: { ctrlKey: true } },
    { name: 'Meta-click', type: 'click', init: { metaKey: true } },
    { name: 'Shift-click', type: 'click', init: { shiftKey: true } },
    { name: 'Alt-click', type: 'click', init: { altKey: true } },
    { name: 'middle auxiliary click', type: 'auxclick', init: { button: 1 } },
    { name: 'context menu', type: 'contextmenu', init: { button: 2 } },
];

it.each(browserNavigationEvents)('leaves safe $name to the browser without calling the opener', async ({ type, init }) => {
    const badge = await renderBadge(`  ${url}  `);
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, detail: 1, ...init });
    expect(await dispatch(badge, event)).toBe(false);
    expect(opened).not.toHaveBeenCalled();
    expect(badge.getAttribute('href')).toBe(url);
    expect(badge.getAttribute('target')).toBe('_blank');
    expect(badge.getAttribute('rel')).toBe('noopener noreferrer');
});

it('does not expose a rejected snapshot URL or send it to an external opener on any navigation path', async () => {
    // Call through to the real owner while observing whether rejected input reaches it.
    const externalOpen = vi.spyOn(externalUrls, 'openExternalUrl');
    const badge = await renderBadge(rejectedUrl);
    expect(badge.hasAttribute('href')).toBe(false);
    for (const { type, init } of [
        { type: 'click', init: { button: 0 } },
        ...browserNavigationEvents,
    ]) {
        await dispatch(badge, new MouseEvent(type, { bubbles: true, cancelable: true, ...init }));
        expect(badge.hasAttribute('href')).toBe(false);
        expect(opened).not.toHaveBeenCalled();
        expect(externalOpen).not.toHaveBeenCalled();
    }
    // A desktop bridge must not receive rejected data either.
    const invoke = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('__TAURI_INTERNALS__', { invoke });
    removeTauriAdapter = installTauriExternalLinkClicks();
    await act(async () => root.render(<WorkerPrBadge sessionId="badge-worker" />));
    await dispatch(badge, new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(invoke).not.toHaveBeenCalled();
    expect(externalOpen).not.toHaveBeenCalled();
});

it.each([
    { name: 'ordinary click', type: 'click', init: { button: 0 } },
    ...browserNavigationEvents.filter(({ type }) => type !== 'contextmenu'),
])('keeps Tauri $name on the system-browser opener', async ({ type, init }) => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('__TAURI_INTERNALS__', { invoke });
    removeTauriAdapter = installTauriExternalLinkClicks();
    const badge = await renderBadge();
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, detail: 1, ...init });
    expect(await dispatch(badge, event)).toBe(true);
    expect(invoke.mock.calls).toEqual([['plugin:opener|open_url', { url }]]);
    expect(opened).not.toHaveBeenCalled();
});

it('prevents Tauri context-menu navigation from bypassing its system-browser adapter', async () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('__TAURI_INTERNALS__', { invoke });
    removeTauriAdapter = installTauriExternalLinkClicks();
    const badge = await renderBadge();
    expect(await dispatch(badge, new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }))).toBe(true);
    expect(invoke).not.toHaveBeenCalled();
    expect(opened).not.toHaveBeenCalled();
});
