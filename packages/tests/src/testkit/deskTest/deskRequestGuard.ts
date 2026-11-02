import type { APIRequestContext, Route } from '@playwright/test';

import { forbiddenOriginLabel, isAllowedOrigin } from './originGuard';

export type BlockedRequest = Readonly<{ url: string; reason: string }>;

/** The fixture calls this after use; the controlled unit test proves a recorded refusal throws. */
export function assertNoBlockedRequests(blocked: readonly BlockedRequest[]): void {
    if (blocked.length) {
        throw new Error(`desk test reached origins it must not: ${blocked.map((entry) => `${entry.url} (${entry.reason})`).join(', ')}`);
    }
}

/**
 * Chromium skips routing redirect requests even after Fetch.fulfillRequest (Playwright 1.58.2,
 * crNetworkManager.js, _onRequest). Never hand the browser a redirect to follow. Fetch one hop at
 * a time, checking before contact, then fulfill only the final response. Cookies use the context's
 * request client. Method/body conversion follows Playwright's server/fetch.js redirect handling.
 */
export async function guardDeskRoute(
    route: Pick<Route, 'request' | 'continue' | 'abort' | 'fetch' | 'fulfill'>,
    request: Pick<APIRequestContext, 'fetch'>,
    allowed: readonly string[],
    blocked: BlockedRequest[],
    extraForbidden: readonly string[] = [],
): Promise<void> {
    const refuse = async (url: string) => {
        blocked.push({ url, reason: forbiddenOriginLabel(url, extraForbidden) ?? 'not on the allowed list' });
        await route.abort('blockedbyclient');
    };
    const original = route.request();
    let url = original.url();
    if (!isAllowedOrigin(url, allowed, extraForbidden)) return refuse(url);

    let method = original.method();
    let data = original.postDataBuffer() ?? undefined;
    const headers = { ...original.headers() };
    let response = await route.fetch({ maxRedirects: 0 });
    try {
        for (let redirects = 0; ; redirects++) {
            const status = response.status();
            const location = response.headers().location;
            if (![301, 302, 303, 307, 308].includes(status) || !location) {
                await route.fulfill({ response });
                return;
            }
            const next = new URL(location, url).href;
            if (!isAllowedOrigin(next, allowed, extraForbidden)) return await refuse(next);
            // Preserve Playwright's documented default redirect budget, rather than inventing one.
            if (redirects === 20) {
                await route.abort('failed');
                throw new Error('Max redirect count exceeded in desk request guard');
            }
            delete headers.cookie; // The context cookie jar owns cookies for the next URL.
            if (new URL(next).origin !== new URL(url).origin) {
                delete headers.authorization;
                delete headers['proxy-authorization'];
            }
            if ('host' in headers) headers.host = new URL(next).host;
            if (((status === 301 || status === 302) && method === 'POST') || (status === 303 && method !== 'GET' && method !== 'HEAD')) {
                method = 'GET';
                data = undefined;
                for (const name of ['content-encoding', 'content-language', 'content-length', 'content-location', 'content-type']) delete headers[name];
            }
            await response.dispose();
            response = await request.fetch(next, { method, headers, data, maxRedirects: 0 });
            url = next;
        }
    } finally {
        await response.dispose();
    }
}
