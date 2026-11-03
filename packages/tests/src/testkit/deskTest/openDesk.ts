import type { Page } from '@playwright/test';

import { gotoDomContentLoadedWithRetries, hasPathname } from '../uiE2e/pageNavigation';

async function waitForDeskReady(page: Page, uiBaseUrl: string, phase: 'sign-in' | 'cold load'): Promise<void> {
    // Keep the desk's existing readiness budget, without the ordinary helper's second timeout/reload.
    const timeoutMs = 120_000;
    const startedAt = Date.now();
    const expectedOrigin = new URL(uiBaseUrl).origin;
    while (Date.now() - startedAt < timeoutMs) {
        if (hasPathname(page.url(), '/desk') && new URL(page.url()).origin === expectedOrigin) {
            const pane = page.getByTestId('ip-coordinator-pane-wrapper');
            // A worker-only desk offers a chooser after sync, with no coordinator composer.
            const contentReady = await pane.getByTestId('session-composer-input').isVisible()
                || await pane.locator('[data-testid^="ip-pick-"]:visible').first().isVisible();
            if (contentReady && await page.getByTestId('ip-top-bar').isVisible()) return;
        }
        const remaining = timeoutMs - (Date.now() - startedAt);
        if (remaining > 0) await page.waitForTimeout(Math.min(250, remaining));
    }
    throw new Error(
        `Desk did not become ready during ${phase} within ${timeoutMs}ms. Expected ${uiBaseUrl}/desk with a visible top bar and coordinator composer or chooser; current URL: ${page.url()}`,
    );
}

/** Signs in on the plain login, then opens the desk with a fresh load, as Luke does each morning. */
export async function openDesk(page: Page, desk: Readonly<{ uiBaseUrl: string }>): Promise<void> {
    await gotoDomContentLoadedWithRetries(page, `${desk.uiBaseUrl}/?happier_hmr=0`, 180_000);
    await waitForDeskReady(page, desk.uiBaseUrl, 'sign-in');
    await gotoDomContentLoadedWithRetries(page, `${desk.uiBaseUrl}/desk`, 120_000);
    await waitForDeskReady(page, desk.uiBaseUrl, 'cold load');
}
