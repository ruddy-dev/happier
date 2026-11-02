import type { APIRequestContext, BrowserContext, Request, Route, WebSocketRoute } from '@playwright/test';
import { expect, test, vi } from 'vitest';

import { runDeskGuardFixture } from './deskGuardFixture';

const origin = 'http://127.0.0.1:23456';
const forbidden = 'http://127.0.0.1:23457';
// Only Playwright's context/route boundary is faked; the fixture and policy run real.
function harness() {
    let handler: Parameters<BrowserContext['route']>[1] | undefined;
    let socketHandler: ((route: WebSocketRoute) => Promise<void> | void) | undefined;
    const context = {
        route: vi.fn<BrowserContext['route']>(async (_url, callback) => { handler = callback; }),
        routeWebSocket: vi.fn<BrowserContext['routeWebSocket']>(async (_url, callback) => { socketHandler = callback; }),
        unrouteAll: vi.fn<BrowserContext['unrouteAll']>(async () => {}),
        request: { fetch: vi.fn<APIRequestContext['fetch']>() } as unknown as APIRequestContext,
    };
    const route = {
        request: () => ({ url: () => `${forbidden}/probe` }) as Request,
        abort: vi.fn(async () => {}),
    } as unknown as Route;
    return {
        context,
        options: { context, baseURL: origin, deskAllowedOrigins: [], deskExtraForbiddenOrigins: [forbidden] },
        route,
        refuse: async () => { if (!handler) throw new Error('HTTP guard not registered'); await handler(route, route.request()); },
        refuseSocket: async () => {
            if (!socketHandler) throw new Error('WebSocket guard not registered');
            await socketHandler({ url: () => forbidden.replace('http:', 'ws:') + '/socket', close: vi.fn(async () => {}) } as unknown as WebSocketRoute);
        },
    };
}

test.each(['http', 'websocket'] as const)('the real %s fixture refusal rejects teardown after unrouting', async (transport) => {
    const h = harness();
    let used = false;
    h.context.unrouteAll.mockImplementation(async () => { expect(used).toBe(true); });
    await expect(runDeskGuardFixture(h.options, async (blocked) => {
        await (transport === 'http' ? h.refuse() : h.refuseSocket());
        expect(blocked).toHaveLength(1);
        used = true;
    })).rejects.toThrow(transport === 'http' ? `${forbidden}/probe` : `${forbidden.replace('http:', 'ws:')}/socket`);
    expect(h.context.unrouteAll).toHaveBeenCalledWith({ behavior: 'ignoreErrors' });
});

test('unroute happens before the blocked assertion, including a refusal delivered during unroute', async () => {
    const h = harness();
    h.context.unrouteAll.mockImplementation(h.refuse);
    await expect(runDeskGuardFixture(h.options, async () => {})).rejects.toThrow(`${forbidden}/probe`);
});

test('a clean fixture resolves after use then unroute', async () => {
    const h = harness();
    const events: string[] = [];
    h.context.unrouteAll.mockImplementation(async () => { events.push('unroute'); });
    await expect(runDeskGuardFixture(h.options, async () => { events.push('use'); })).resolves.toBeUndefined();
    expect(events).toEqual(['use', 'unroute']);
});

test('the refusal assertion still runs when unroute rejects', async () => {
    const h = harness();
    h.context.unrouteAll.mockRejectedValue(new Error('unroute failed'));
    await expect(runDeskGuardFixture(h.options, async () => { await h.refuse(); })).rejects.toThrow(`${forbidden}/probe`);
});

test('an unroute failure with no refusal still propagates', async () => {
    const h = harness();
    const error = new Error('unroute failed');
    h.context.unrouteAll.mockRejectedValue(error);
    await expect(runDeskGuardFixture(h.options, async () => {})).rejects.toBe(error);
});

test('a refusal before closed-target abort still fails the real fixture teardown', async () => {
    const h = harness();
    vi.mocked(h.route.abort).mockRejectedValue(new Error('route.abort: Target page, context or browser has been closed'));
    await expect(runDeskGuardFixture(h.options, async () => {
        await expect(h.refuse()).resolves.toBeUndefined();
    })).rejects.toThrow(`${forbidden}/probe`);
    expect(h.context.unrouteAll).toHaveBeenCalledWith({ behavior: 'ignoreErrors' });
});

test('unroute and the refusal assertion still run if use throws', async () => {
    const h = harness();
    await expect(runDeskGuardFixture(h.options, async () => {
        await h.refuse();
        throw new Error('use failed');
    })).rejects.toThrow(`${forbidden}/probe`);
    expect(h.context.unrouteAll).toHaveBeenCalledWith({ behavior: 'ignoreErrors' });
});
