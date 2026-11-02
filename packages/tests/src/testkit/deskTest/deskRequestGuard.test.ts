import type { APIRequestContext, APIResponse, Request } from '@playwright/test';
import { expect, test, vi } from 'vitest';
import { assertNoBlockedRequests, guardDeskRoute, type BlockedRequest } from './deskRequestGuard';

const allowed = ['http://127.0.0.1:23456'];
const forbidden = 'http://127.0.0.1:23457';
// These narrow fixtures replace only Playwright's network objects. Policy and redirect logic run real.
function response(status: number, location?: string): APIResponse {
    return { status: () => status, headers: () => location ? { location } : {}, dispose: vi.fn(async () => {}) } as unknown as APIResponse;
}
function harness(first: APIResponse, url = `${allowed[0]}/start`, method = 'GET', body: Buffer | null = null) {
    const route = {
        request: () => ({ url: () => url, method: () => method, headers: () => ({ 'content-type': 'application/json' }), postDataBuffer: () => body }) as unknown as Request,
        continue: vi.fn(async () => {}),
        abort: vi.fn(async () => {}),
        fetch: vi.fn(async () => first),
        fulfill: vi.fn(async () => {}),
    };
    const request = { fetch: vi.fn<APIRequestContext['fetch']>(async () => response(200)) };
    const blocked: BlockedRequest[] = [];
    return { route, request, blocked };
}

test('a direct refusal contacts no network and records the exact destination', async () => {
    const h = harness(response(200), `${forbidden}/probe`);
    await guardDeskRoute(h.route, h.request, [...allowed, forbidden], h.blocked, [forbidden]);
    expect(h.blocked).toEqual([{ url: `${forbidden}/probe`, reason: 'a test-only forbidden origin' }]);
    expect(h.route.fetch).not.toHaveBeenCalled();
    expect(h.route.continue).not.toHaveBeenCalled();
    expect(h.route.abort).toHaveBeenCalledWith('blockedbyclient');
});

test('a forbidden redirect is refused before the destination is fetched', async () => {
    const h = harness(response(302, `${forbidden}/target`));
    await guardDeskRoute(h.route, h.request, allowed, h.blocked, [forbidden]);
    expect(h.route.fetch).toHaveBeenCalledWith({ maxRedirects: 0 });
    expect(h.blocked).toEqual([{ url: `${forbidden}/target`, reason: 'a test-only forbidden origin' }]);
    expect(h.request.fetch).not.toHaveBeenCalled();
    expect(h.route.fulfill).not.toHaveBeenCalled();
    expect(h.route.abort).toHaveBeenCalledWith('blockedbyclient');
});

test('an allowed intermediate hop cannot hide a second forbidden redirect', async () => {
    const h = harness(response(302, '/next'));
    h.request.fetch.mockResolvedValue(response(307, `${forbidden}/target`));
    await guardDeskRoute(h.route, h.request, allowed, h.blocked, [forbidden]);
    expect(h.request.fetch.mock.calls.map(([url]) => url)).toEqual([`${allowed[0]}/next`]);
    expect(h.blocked).toEqual([{ url: `${forbidden}/target`, reason: 'a test-only forbidden origin' }]);
    expect(h.route.fulfill).not.toHaveBeenCalled();
});

test.each([302, 303, 307, 308])('allowed %s redirects retain browser method/body semantics and fulfill the final response', async (status) => {
    const h = harness(response(status, '/next'), `${allowed[0]}/start`, 'POST', Buffer.from('{}'));
    const final = response(200);
    h.request.fetch.mockResolvedValue(final);
    await guardDeskRoute(h.route, h.request, allowed, h.blocked);
    expect(h.blocked).toEqual([]);
    expect(h.request.fetch).toHaveBeenCalledWith(`${allowed[0]}/next`, expect.objectContaining({
        maxRedirects: 0, method: status === 302 || status === 303 ? 'GET' : 'POST',
        data: status === 302 || status === 303 ? undefined : Buffer.from('{}'),
    }));
    expect(h.route.fulfill).toHaveBeenCalledWith({ response: final });
});

// The exact same assertion runs at fixture teardown, without expected-failure browser probes.
test('a recorded refusal fails the fixture check; an empty record passes', () => {
    expect(() => assertNoBlockedRequests([{ url: `${forbidden}/probe`, reason: 'a test-only forbidden origin' }])).toThrow(`${forbidden}/probe (a test-only forbidden origin)`);
    expect(() => assertNoBlockedRequests([])).not.toThrow();
});
