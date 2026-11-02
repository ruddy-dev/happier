import type { APIRequestContext, APIResponse, Request } from '@playwright/test';
import { expect, test, vi } from 'vitest';
import { assertNoBlockedRequests, guardDeskRoute, type BlockedRequest } from './deskRequestGuard';

const allowed = ['http://127.0.0.1:23456'];
const forbidden = 'http://127.0.0.1:23457';
// These narrow fixtures replace only Playwright's network objects. Policy and redirect logic run real.
function response(status: number, location?: string): APIResponse {
    return { status: () => status, headers: () => location !== undefined ? { location } : {}, dispose: vi.fn(async () => {}) } as unknown as APIResponse;
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

test.each(['route.fetch', 'request.fetch', 'route.fulfill'] as const)('%s quietly ends on a closed target without recording a refusal', async (call) => {
    const h = harness(response(call === 'request.fetch' ? 302 : 200, '/next'));
    const error = new Error(`${call}: Target page, context or browser has been closed\nCall log:`);
    if (call === 'route.fetch') h.route.fetch.mockRejectedValue(error);
    if (call === 'request.fetch') h.request.fetch.mockRejectedValue(error);
    if (call === 'route.fulfill') h.route.fulfill.mockRejectedValue(error);
    await expect(guardDeskRoute(h.route, h.request, allowed, h.blocked)).resolves.toBeUndefined();
    expect(h.blocked).toEqual([]);
});

test.each(['route.fetch', 'request.fetch', 'route.fulfill', 'route.abort'] as const)('%s still propagates a non-closed-target failure', async (call) => {
    const h = harness(response(call === 'request.fetch' ? 302 : 200, '/next'), call === 'route.abort' ? `${forbidden}/probe` : undefined);
    const error = new Error(`${call}: connection failed`);
    if (call === 'route.fetch') h.route.fetch.mockRejectedValue(error);
    if (call === 'request.fetch') h.request.fetch.mockRejectedValue(error);
    if (call === 'route.fulfill') h.route.fulfill.mockRejectedValue(error);
    if (call === 'route.abort') h.route.abort.mockRejectedValue(error);
    await expect(guardDeskRoute(h.route, h.request, allowed, h.blocked)).rejects.toBe(error);
});

test('a closed-target abort ends quietly and preserves the refusal recorded before it', async () => {
    const h = harness(response(200), `${forbidden}/probe`);
    h.route.abort.mockRejectedValue(new Error('route.abort: Target page, context or browser has been closed'));
    await expect(guardDeskRoute(h.route, h.request, allowed, h.blocked, [forbidden])).resolves.toBeUndefined();
    expect(h.blocked).toEqual([{ url: `${forbidden}/probe`, reason: 'a test-only forbidden origin' }]);
    expect(() => assertNoBlockedRequests(h.blocked)).toThrow(`${forbidden}/probe`);
    expect(h.route.fetch).not.toHaveBeenCalled();
});

test.each(['', '   '])('a present Location %j is resolved and checked before a later forbidden hop', async (location) => {
    const h = harness(response(302, location), `${allowed[0]}/start`, 'POST', Buffer.from('{}'));
    h.request.fetch.mockResolvedValue(response(302, `${forbidden}/target`));
    await guardDeskRoute(h.route, h.request, allowed, h.blocked, [forbidden]);
    expect(h.request.fetch).toHaveBeenCalledWith(`${allowed[0]}/start`, expect.objectContaining({ method: 'GET', data: undefined, maxRedirects: 0 }));
    expect(h.blocked).toEqual([{ url: `${forbidden}/target`, reason: 'a test-only forbidden origin' }]);
    expect(h.route.fulfill).not.toHaveBeenCalled();
});

test('an unparsable Location is recorded and aborted without a browser redirect', async () => {
    const h = harness(response(302, 'http://['));
    await expect(guardDeskRoute(h.route, h.request, allowed, h.blocked)).resolves.toBeUndefined();
    expect(h.blocked).toEqual([{ url: 'http://[', reason: 'invalid redirect location' }]);
    expect(h.route.abort).toHaveBeenCalledWith('blockedbyclient');
    expect(h.request.fetch).not.toHaveBeenCalled();
    expect(h.route.fulfill).not.toHaveBeenCalled();
});

test.each([300, 304, 399])('a %s with Location never reaches the browser as a redirect', async (status) => {
    const h = harness(response(status, `${forbidden}/target`));
    await guardDeskRoute(h.route, h.request, allowed, h.blocked, [forbidden]);
    expect(h.blocked).toEqual([{ url: `${forbidden}/target`, reason: 'a test-only forbidden origin' }]);
    expect(h.route.fulfill).not.toHaveBeenCalled();
});

test('a 3xx without Location is a terminal response', async () => {
    const final = response(302);
    const h = harness(final);
    await guardDeskRoute(h.route, h.request, allowed, h.blocked);
    expect(h.route.fulfill).toHaveBeenCalledWith({ response: final });
    expect(h.blocked).toEqual([]);
});

test.each(['', '   ', '/next'])('the redirect cap records a refusal for Location %j before aborting', async (location) => {
    const h = harness(response(302, location));
    h.request.fetch.mockResolvedValue(response(302, location));
    await expect(guardDeskRoute(h.route, h.request, allowed, h.blocked)).rejects.toThrow('Max redirect count exceeded');
    expect(h.request.fetch).toHaveBeenCalledTimes(20);
    expect(h.blocked).toEqual([{ url: new URL(location, `${allowed[0]}/start`).href, reason: 'too many redirects' }]);
    expect(h.route.abort).toHaveBeenCalledWith('failed');
    expect(h.route.fulfill).not.toHaveBeenCalled();
});

test('the twentieth redirect may still reach a terminal response', async () => {
    const h = harness(response(302, '/next'));
    const final = response(200);
    h.request.fetch.mockResolvedValue(response(302, '/next'));
    h.request.fetch.mockImplementationOnce(async () => response(302, '/next'));
    for (let i = 1; i < 19; i++) h.request.fetch.mockResolvedValueOnce(response(302, '/next'));
    h.request.fetch.mockResolvedValueOnce(final);
    await guardDeskRoute(h.route, h.request, allowed, h.blocked);
    expect(h.request.fetch).toHaveBeenCalledTimes(20);
    expect(h.route.fulfill).toHaveBeenCalledWith({ response: final });
    expect(h.blocked).toEqual([]);
});

test('a closed target during response cleanup cannot hide an unrelated fulfill failure', async () => {
    const final = response(200);
    const h = harness(final);
    const error = new Error('route.fulfill: connection failed');
    h.route.fulfill.mockRejectedValue(error);
    vi.mocked(final.dispose).mockRejectedValue(new Error('Target page, context or browser has been closed'));
    await expect(guardDeskRoute(h.route, h.request, allowed, h.blocked)).rejects.toBe(error);
    expect(h.blocked).toEqual([]);
});

test('a closed-target abort at the redirect cap preserves its blocked entry', async () => {
    const h = harness(response(302, '/next'));
    h.request.fetch.mockResolvedValue(response(302, '/next'));
    h.route.abort.mockRejectedValue(new Error('route.abort: Target page, context or browser has been closed'));
    await expect(guardDeskRoute(h.route, h.request, allowed, h.blocked)).resolves.toBeUndefined();
    expect(h.blocked).toEqual([{ url: `${allowed[0]}/next`, reason: 'too many redirects' }]);
    expect(() => assertNoBlockedRequests(h.blocked)).toThrow('too many redirects');
});
