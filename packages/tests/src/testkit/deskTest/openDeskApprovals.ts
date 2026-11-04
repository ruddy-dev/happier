import type { Page } from '@playwright/test';

/** The desktop drawer can already be open after a route reload. */
export async function openDeskApprovals(page: Page): Promise<void> {
    const desk = page.locator('[data-ip-font="desk"]:visible');
    const drawer = desk.getByTestId('ip-approvals-drawer');
    const opener = desk.getByTestId('ip-approvals-open');
    const closedOpener = opener.and(desk.getByRole('button', { name: /^Show what waits on you,/ }));
    const openOpener = opener.and(desk.getByRole('button', { name: /^Hide what waits on you,/ }));
    await opener.waitFor({ state: 'visible' });
    // A Hide opener may precede the drawer's visible mount. Wait instead of toggling it shut.
    if (!await drawer.isVisible() && await closedOpener.isVisible()) await closedOpener.click();
    await drawer.waitFor({ state: 'visible' });
    await openOpener.waitFor({ state: 'visible' });
}
