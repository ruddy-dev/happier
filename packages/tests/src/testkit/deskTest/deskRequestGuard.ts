import type { APIRequestContext, Route } from '@playwright/test';

import { forbiddenOriginLabel, isAllowedOrigin } from './originGuard';

export type BlockedRequest = Readonly<{ url: string; reason: string }>;

/** The fixture calls this after use; the controlled unit test proves a recorded refusal throws. */
export function assertNoBlockedRequests(blocked: readonly BlockedRequest[]): void {
    if (blocked.length) {
        throw new Error(`desk test reached origins it must not: ${blocked.map((entry) => `${entry.url} (${entry.reason})`).join(', ')}`);
    }
}

/** HTTP guard used by the desk fixture. Route and request are Playwright's network boundary. */
export async function guardDeskRoute(
    route: Pick<Route, 'request' | 'continue' | 'abort' | 'fetch' | 'fulfill'>,
    request: Pick<APIRequestContext, 'fetch'>,
    allowed: readonly string[],
    blocked: BlockedRequest[],
    extraForbidden: readonly string[] = [],
): Promise<void> {
    const url = route.request().url();
    if (isAllowedOrigin(url, allowed)) {
        await route.continue();
        return;
    }
    blocked.push({ url, reason: forbiddenOriginLabel(url) ?? 'not on the allowed list' });
    await route.abort('blockedbyclient');
}
