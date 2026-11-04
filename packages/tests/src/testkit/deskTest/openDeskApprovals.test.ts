import type { Page } from '@playwright/test';
import { expect, it } from 'vitest';

import { openDeskApprovals } from './openDeskApprovals';

// Browser locator boundary: no aria-expanded, unmounted closed drawer, accessible
// Show/Hide names, and a hidden previous route with duplicate test IDs.
function browser(initial: boolean, delayed = false) {
    const state = { open: initial, visible: initial, hiddenOpen: true, clicks: 0 };
    let mounted: (() => void) | undefined;
    const mounting = new Promise<void>(resolve => { mounted = resolve; });
    type Element = 'opener' | 'drawer';
    interface BoundaryLocator {
        getByTestId(id: string): BoundaryLocator;
        getByRole(role: string, options: { name: RegExp }): BoundaryLocator;
        and(other: BoundaryLocator): Pick<BoundaryLocator, 'isVisible' | 'waitFor' | 'click'>;
        isVisible(): Promise<boolean>;
        getAttribute(attribute: string): Promise<string | null>;
        click(): Promise<void>;
        waitFor(): Promise<void>;
    }
    function locator(active: boolean, element?: Element, name?: RegExp): BoundaryLocator {
        const visible = () => active && (element === 'drawer' ? state.visible :
            !name || name.test(`${state.open ? 'Hide' : 'Show'} what waits on you, 1 request`));
        return {
            getByTestId: (id: string) => {
                if (!['ip-approvals-open', 'ip-approvals-drawer'].includes(id)) throw new Error('Unexpected test ID');
                return locator(active, id === 'ip-approvals-open' ? 'opener' : 'drawer');
            },
            getByRole: (role: string, options: { name: RegExp }) => {
                if (role !== 'button') throw new Error('Unexpected role');
                return locator(active, 'opener', options.name);
            },
            and: (other: { isVisible: () => Promise<boolean>; waitFor: () => Promise<void> }) => ({
                isVisible: async () => visible() && await other.isVisible(),
                waitFor: async () => { await other.waitFor(); if (!visible()) throw new Error('Control unavailable'); },
                click: async () => { await other.waitFor(); await locator(active, element).click(); },
            }),
            isVisible: async () => visible(),
            getAttribute: async (attribute: string) => attribute === 'aria-label'
                ? `${state.open ? 'Hide' : 'Show'} what waits on you, 1 request` : null,
            click: async () => {
                if (!active) { state.hiddenOpen = !state.hiddenOpen; return; }
                state.clicks++;
                state.open = !state.open;
                if (!delayed || !state.open) state.visible = state.open;
            },
            waitFor: async () => {
                if (element === 'drawer' && delayed && !state.visible) await mounting;
                if (!visible()) throw new Error('Control unavailable');
            },
        };
    }
    const page = {
        // Old helper sees the real missing attribute, rather than a fake guaranteeing it.
        getByTestId: (id: string) => ({
            ...locator(false).getByTestId(id),
            isVisible: async () => { throw new Error('Unscoped duplicate test IDs'); },
            click: async () => { throw new Error('Unscoped duplicate test IDs'); },
        }),
        locator: (selector: string) => {
            if (selector !== '[data-ip-font="desk"]:visible') throw new Error('Desk must be scoped to the visible route');
            return locator(true);
        },
    } as unknown as Page;
    return { page, state, mount: () => { state.visible = true; mounted!(); } };
}

it.each([false, true])('opens Waiting without closing an already-open drawer: initial=%s', async initial => {
    const { page, state } = browser(initial);
    await openDeskApprovals(page);
    expect(state.open && state.visible).toBe(true);
    expect(state.clicks).toBe(initial ? 0 : 1);
    expect(state.hiddenOpen).toBe(true);
});

it.each([false, true])('waits for the drawer when its mount is delayed: opener already open=%s', async open => {
    const { page, state, mount } = browser(open, true);
    state.visible = false;
    let finished = false;
    const pending = openDeskApprovals(page).then(() => { finished = true; });
    // Observe rejection promptly during RED, before releasing the deferred browser mount.
    const observed = pending.catch(error => error);
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(finished).toBe(false);
    mount();
    await pending;
    await observed;
    expect(state.open && state.visible).toBe(true);
    expect(state.clicks).toBe(open ? 0 : 1);
});
