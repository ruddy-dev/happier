import type { BrowserContext } from '@playwright/test';

import { assertNoBlockedRequests, guardDeskRoute, isClosedTargetError, type BlockedRequest } from './deskRequestGuard';
import { forbiddenOriginLabel, isAllowedOrigin } from './originGuard';

type DeskGuardOptions = {
    context: Pick<BrowserContext, 'route' | 'routeWebSocket' | 'request' | 'unrouteAll' | 'pages'>;
    deskAllowedOrigins: string[];
    deskExtraForbiddenOrigins: string[];
    baseURL?: string;
};

// After page closure, this teardown-only bound makes an unsettled callback fail with its
// URL, within the desk config's 240 s fixture timeout. It does not limit live requests.
const GUARD_DRAIN_TIMEOUT_MS = 5_000;

/** The actual auto-fixture body, also runnable with a browser-free context boundary. */
export async function runDeskGuardFixture(
    { context, deskAllowedOrigins, deskExtraForbiddenOrigins, baseURL }: DeskGuardOptions,
    use: (blocked: BlockedRequest[]) => Promise<void>,
): Promise<void> {
    const allowed = baseURL ? [baseURL, ...deskAllowedOrigins] : deskAllowedOrigins;
    const blocked: BlockedRequest[] = [];
    const pending = new Map<Promise<void>, string>();
    const errors: unknown[] = [];
    const track = (url: string, callback: () => Promise<void>): Promise<void> => {
        // Observe failures here, before Playwright can swallow a late callback exception.
        // The fixture reports them after all callbacks settle, including already finished ones.
        const invocation = Promise.resolve().then(callback).catch((error: unknown) => {
            if (!isClosedTargetError(error)) {
                errors.push(new Error(`desk guard failed for ${url}: ${error instanceof Error ? error.message : String(error)}`, { cause: error }));
            }
        }).finally(() => { pending.delete(invocation); });
        pending.set(invocation, url);
        return invocation;
    };
    await context.route('**/*', (route) => track(route.request().url(), () =>
        guardDeskRoute(route, context.request, allowed, blocked, deskExtraForbiddenOrigins)));
    await context.routeWebSocket(() => true, (socket) => track(socket.url(), async () => {
        const url = socket.url();
        if (isAllowedOrigin(url, allowed, deskExtraForbiddenOrigins)) {
            socket.connectToServer();
            return;
        }
        blocked.push({ url, reason: forbiddenOriginLabel(url, deskExtraForbiddenOrigins) ?? 'not on the allowed list' });
        await socket.close();
    }));
    try {
        await use(blocked);
    } finally {
        // Keep both guards installed while closing pages, so no page can start unguarded traffic.
        // Context-request fetches can outlive pages in Playwright 1.58.2.
        const closures = await Promise.allSettled(context.pages().map((page) => page.close()));
        for (const result of closures) {
            if (result.status === 'rejected' && !isClosedTargetError(result.reason)) errors.push(result.reason);
        }
        try {
            // Cancel outstanding route.fetch/request.fetch operations through their transport owner.
            await context.request.dispose();
        } catch (error) {
            if (!isClosedTargetError(error)) errors.push(error);
        }
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
            await Promise.race([
                (async () => {
                    // Include callbacks delivered during closure/disposal or while another callback settles.
                    while (pending.size) await Promise.allSettled([...pending.keys()]);
                })(),
                new Promise<never>((_resolve, reject) => {
                    timer = setTimeout(() => reject(new Error(
                        `desk guard stuck after ${GUARD_DRAIN_TIMEOUT_MS} ms: ${[...pending.values()].join(', ')}`,
                    )), GUARD_DRAIN_TIMEOUT_MS);
                }),
            ]);
        } catch (error) {
            errors.push(error);
        } finally {
            clearTimeout(timer);
        }
        if (!pending.size && closures.every((result) => result.status === 'fulfilled' || isClosedTargetError(result.reason))) {
            try {
                // Plain unroute is sufficient: our HTTP and WebSocket callbacks have settled.
                // Playwright 1.58.2 has no WebSocket unroute API; those routes end with the context.
                await context.unrouteAll();
            } catch (error) {
                if (!isClosedTargetError(error)) errors.push(error);
            }
        }
        // On a drain timeout leave the guards installed for Playwright's context teardown.
        // A refusal or cap is still reported even if abort/close ended on a closed target.
        try {
            assertNoBlockedRequests(blocked);
        } catch (error) {
            errors.push(error);
        }
        if (errors.length === 1) throw errors[0];
        if (errors.length) throw new AggregateError(errors, errors.map((error) => error instanceof Error ? error.message : String(error)).join('\n'));
    }
}
