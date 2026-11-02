import type { BrowserContext } from '@playwright/test';

import { assertNoBlockedRequests, guardDeskRoute, type BlockedRequest } from './deskRequestGuard';
import { forbiddenOriginLabel, isAllowedOrigin } from './originGuard';

type DeskGuardOptions = {
    context: Pick<BrowserContext, 'route' | 'routeWebSocket' | 'request' | 'unrouteAll'>;
    deskAllowedOrigins: string[];
    deskExtraForbiddenOrigins: string[];
    baseURL?: string;
};

/** The actual auto-fixture body, also runnable with a browser-free context boundary. */
export async function runDeskGuardFixture(
    { context, deskAllowedOrigins, deskExtraForbiddenOrigins, baseURL }: DeskGuardOptions,
    use: (blocked: BlockedRequest[]) => Promise<void>,
): Promise<void> {
    const allowed = baseURL ? [baseURL, ...deskAllowedOrigins] : deskAllowedOrigins;
    const blocked: BlockedRequest[] = [];
    await context.route('**/*', (route) => guardDeskRoute(route, context.request, allowed, blocked, deskExtraForbiddenOrigins));
    await context.routeWebSocket(() => true, async (socket) => {
        const url = socket.url();
        if (isAllowedOrigin(url, allowed, deskExtraForbiddenOrigins)) {
            socket.connectToServer();
            return;
        }
        blocked.push({ url, reason: forbiddenOriginLabel(url, deskExtraForbiddenOrigins) ?? 'not on the allowed list' });
        await socket.close();
    });
    try {
        await use(blocked);
    } finally {
        try {
            // Stop in-flight polling handlers before context teardown. Playwright 1.58.2 has
            // no WebSocket unroute API; those routes end with the context.
            await context.unrouteAll({ behavior: 'ignoreErrors' });
        } finally {
            assertNoBlockedRequests(blocked);
        }
    }
}
