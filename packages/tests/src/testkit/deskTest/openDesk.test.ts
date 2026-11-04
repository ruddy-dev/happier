import type { Locator, Page } from '@playwright/test';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { openDesk } from './openDesk';

const uiBaseUrl = 'http://127.0.0.1:23456';
type View = 'welcome' | 'coordinator' | 'chooser' | 'shell' | 'hidden-chooser' | 'other-route' | 'foreign-composer' | 'restore-root';

// Fake only Playwright's browser boundary. Navigation and both readiness passes run real.
function browser(first: View, cold: View = first, signedIn = false) {
    let now = 0;
    let currentUrl = 'about:blank';
    let view: View = 'welcome';
    let load = 0;
    const readyLoads: number[] = [];
    const navigations: string[] = [];
    vi.spyOn(Date, 'now').mockImplementation(() => now);

    const visible = (selector: string, inCoordinator: boolean) => {
        if (view === 'welcome') return selector === 'welcome-mtls-login';
        if (selector === 'ip-top-bar' || selector === 'ip-coordinator-pane-wrapper') return true;
        if (selector === 'session-composer-input') return view === 'coordinator' || view === 'other-route'
            || (view === 'foreign-composer' && !inCoordinator);
        return selector.includes('ip-pick-') && view === 'chooser';
    };
    const locator = (selector: string, inCoordinator = false): Locator => ({
        count: async () => Number(visible(selector, inCoordinator)
            || (selector.includes('ip-pick-') && view === 'hidden-chooser' && !selector.includes(':visible'))),
        isVisible: async () => visible(selector, inCoordinator),
        first: () => locator(selector, inCoordinator),
        locator: (child: string) => locator(child, inCoordinator || selector === 'ip-coordinator-pane-wrapper'),
        getByTestId: (child: string) => locator(child, inCoordinator || selector === 'ip-coordinator-pane-wrapper'),
    } as unknown as Locator);
    const page = {
        goto: vi.fn<Page['goto']>(async url => {
            navigations.push(url);
            load++;
            view = 'welcome';
            currentUrl = url;
            if (load === 1 && signedIn) {
                view = first;
                currentUrl = `${uiBaseUrl}/desk`;
                readyLoads.push(load);
            }
            return null;
        }),
        url: () => currentUrl,
        evaluate: async () => {}, // no count observer in these readiness-only cases
        getByTestId: (id: string) => locator(id),
        getByRole: () => locator('unused-role'),
        locator,
        reload: vi.fn(async () => { throw new Error('A readiness failure must not silently reload'); }),
        waitForTimeout: async (ms: number) => {
            now += ms;
            const next = load === 1 ? first : cold;
            if (view === 'welcome' && next !== 'welcome') {
                view = next;
                currentUrl = next === 'other-route' ? `${uiBaseUrl}/desk/settings` : next === 'restore-root' ? `${uiBaseUrl}/` : `${uiBaseUrl}/desk`;
                readyLoads.push(load);
            }
        },
    };
    return { page: page as unknown as Page, navigations, readyLoads, elapsed: () => now };
}

afterEach(() => vi.restoreAllMocks());

describe('openDesk', () => {
    it('opens the ordinary desk route after restore has returned to root', async () => {
        const h = browser('restore-root', 'chooser');
        await openDesk(h.page, {
            uiBaseUrl,
            openAuthenticatedPage: async page => {
                await page.goto(`${uiBaseUrl}/restore/manual`);
                await page.waitForTimeout(1);
            },
        });
        expect(h.navigations).toEqual([`${uiBaseUrl}/restore/manual`, `${uiBaseUrl}/desk`]);
    });

    it('keeps the first authenticated document so cold-load observations survive', async () => {
        const h = browser('chooser');
        await openDesk(h.page, {
            uiBaseUrl,
            openAuthenticatedPage: async page => { await page.goto(`${uiBaseUrl}/restore/manual`); },
        });
        expect(h.navigations).toEqual([`${uiBaseUrl}/restore/manual`]);
        expect(h.readyLoads).toEqual([1]);
    });

    it('still requires a ready desk after production authentication', async () => {
        const h = browser('shell');
        await expect(openDesk(h.page, {
            uiBaseUrl,
            openAuthenticatedPage: async page => { await page.goto(`${uiBaseUrl}/restore/manual`); },
        })).rejects.toThrow(/Desk.*cold load.*120000ms/);
        expect(h.navigations).toEqual([`${uiBaseUrl}/restore/manual`]);
    });

    it.each(['coordinator', 'chooser'] as const)('waits through sign-in and a fresh desk load with a %s', async view => {
        const h = browser(view);
        await expect(openDesk(h.page, { uiBaseUrl })).resolves.toBeUndefined();
        expect(h.navigations).toEqual([`${uiBaseUrl}/?happier_hmr=0`, `${uiBaseUrl}/desk`]);
        expect(h.readyLoads).toEqual([1, 2]);
    });

    it('accepts the already loaded worker-only chooser reached from the signed-in root', async () => {
        const h = browser('chooser', 'chooser', true);
        await expect(openDesk(h.page, { uiBaseUrl })).resolves.toBeUndefined();
        expect(h.readyLoads).toEqual([1, 2]);
    });

    it.each(['welcome', 'shell', 'hidden-chooser', 'other-route', 'foreign-composer'] as const)(
        'rejects %s within the sign-in readiness budget', async view => {
            const h = browser(view);
            await expect(openDesk(h.page, { uiBaseUrl })).rejects.toThrow(/Desk.*sign-in.*120000ms/);
            expect(h.navigations).toEqual([`${uiBaseUrl}/?happier_hmr=0`]);
            expect(h.elapsed()).toBe(120_000);
        },
    );

    it('does not return after the fresh load when only the signed-in load was ready', async () => {
        const h = browser('chooser', 'shell');
        await expect(openDesk(h.page, { uiBaseUrl })).rejects.toThrow(/Desk.*cold load.*120000ms/);
        expect(h.readyLoads).toEqual([1, 2]);
        expect(h.elapsed()).toBe(120_250);
    });
});
