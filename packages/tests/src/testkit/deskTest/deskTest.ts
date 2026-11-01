import { expect, test as base } from '@playwright/test';

import { forbiddenOriginLabel, isAllowedOrigin } from './originGuard';

/**
 * Playwright `test` for desk scenarios: every request and websocket from the page must go to an
 * origin the test lists (the UI, its local server, the forwarded-header proxy). Anything else is
 * aborted and fails the test, naming the URL and why it was refused.
 *
 * Not run yet: it needs Playwright with a browser on this machine (desk-build README section 2, step 8).
 */

export type BlockedRequest = Readonly<{ url: string; reason: string }>;

export type DeskTestOptions = {
    /** Origins the page may reach, besides the configured `baseURL`. */
    deskAllowedOrigins: string[];
};

type DeskTestFixtures = {
    /** Requests the guard refused so far; the fixture fails the test if any remain at the end. */
    blockedRequests: BlockedRequest[];
};

function refusalReason(url: string): string {
    return forbiddenOriginLabel(url) ?? 'not on the allowed list';
}

export const deskTest = base.extend<DeskTestFixtures & DeskTestOptions>({
    deskAllowedOrigins: [[], { option: true }],
    blockedRequests: [
        async ({ context, deskAllowedOrigins, baseURL }, use) => {
            const allowed = baseURL ? [baseURL, ...deskAllowedOrigins] : deskAllowedOrigins;
            const blocked: BlockedRequest[] = [];
            await context.route('**/*', async (route) => {
                const url = route.request().url();
                if (isAllowedOrigin(url, allowed)) {
                    await route.continue();
                    return;
                }
                blocked.push({ url, reason: refusalReason(url) });
                await route.abort('blockedbyclient');
            });
            await context.routeWebSocket(() => true, async (socket) => {
                const url = socket.url();
                if (isAllowedOrigin(url, allowed)) {
                    socket.connectToServer();
                    return;
                }
                blocked.push({ url, reason: refusalReason(url) });
                await socket.close();
            });
            await use(blocked);
            expect(
                blocked,
                `desk test reached origins it must not: ${blocked.map((entry) => `${entry.url} (${entry.reason})`).join(', ')}`,
            ).toEqual([]);
        },
        { auto: true },
    ],
});
