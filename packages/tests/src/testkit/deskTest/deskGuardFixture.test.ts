import type { APIRequestContext, APIResponse, BrowserContext, Page, Request, Route, WebSocketRoute } from '@playwright/test';
import { expect, test, vi } from 'vitest';

import { runDeskGuardFixture } from './deskGuardFixture';

const origin = 'http://127.0.0.1:23456';
const forbidden = 'http://127.0.0.1:23457';
// Only Playwright's context/route boundary is faked; the fixture and policy run real.
function harness() {
    let handler: Parameters<BrowserContext['route']>[1] | undefined;
    let socketHandler: ((route: WebSocketRoute) => Promise<void> | void) | undefined;
    const page = { close: vi.fn(async () => {}) };
    const context = {
        pages: () => [page as unknown as Page],
        route: vi.fn<BrowserContext['route']>(async (_url, callback) => { handler = callback; }),
        routeWebSocket: vi.fn<BrowserContext['routeWebSocket']>(async (_url, callback) => { socketHandler = callback; }),
        unrouteAll: vi.fn<BrowserContext['unrouteAll']>(async () => {}),
        request: {
            fetch: vi.fn<APIRequestContext['fetch']>(),
            dispose: vi.fn<APIRequestContext['dispose']>(async () => {}),
        } as unknown as APIRequestContext,
    };
    const route = {
        request: () => ({ url: () => `${forbidden}/probe` }) as Request,
        abort: vi.fn(async () => {}),
    } as unknown as Route;
    return {
        context,
        page,
        dispatch: async (route: Route) => { if (!handler) throw new Error('HTTP guard not registered'); await handler(route, route.request()); },
        options: { context, baseURL: origin, deskAllowedOrigins: [], deskExtraForbiddenOrigins: [forbidden] },
        route,
        refuse: async () => { if (!handler) throw new Error('HTTP guard not registered'); await handler(route, route.request()); },
        refuseSocket: async (close: () => Promise<void> = async () => {}) => {
            if (!socketHandler) throw new Error('WebSocket guard not registered');
            await socketHandler({ url: () => forbidden.replace('http:', 'ws:') + '/socket', close } as unknown as WebSocketRoute);
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
    expect(h.context.unrouteAll).toHaveBeenCalledWith();
});

test('pages close while still guarded, including a WebSocket refusal delivered during close', async () => {
    const h = harness();
    h.page.close.mockImplementation(async () => { await h.refuseSocket(); });
    await expect(runDeskGuardFixture(h.options, async () => {})).rejects.toThrow(`${forbidden.replace('http:', 'ws:')}/socket`);
});

test('a clean fixture closes pages, disposes the request client, then unroutes after use', async () => {
    const h = harness();
    const events: string[] = [];
    h.page.close.mockImplementation(async () => { events.push('close'); });
    vi.mocked(h.context.request.dispose).mockImplementation(async () => { events.push('dispose'); });
    h.context.unrouteAll.mockImplementation(async () => { events.push('unroute'); });
    await expect(runDeskGuardFixture(h.options, async () => { events.push('use'); })).resolves.toBeUndefined();
    expect(events).toEqual(['use', 'close', 'dispose', 'unroute']);
    expect(h.context.request.dispose).toHaveBeenCalledWith();
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
    expect(h.context.unrouteAll).toHaveBeenCalledWith();
});

test('unroute and the refusal assertion still run if use throws', async () => {
    const h = harness();
    await expect(runDeskGuardFixture(h.options, async () => {
        await h.refuse();
        throw new Error('use failed');
    })).rejects.toThrow(`${forbidden}/probe`);
    expect(h.context.unrouteAll).toHaveBeenCalledWith();
});

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}
function response(status: number, location?: string): APIResponse {
    return { status: () => status, headers: () => location === undefined ? {} : { location }, dispose: async () => {} } as unknown as APIResponse;
}
function pendingRoute(pending: Promise<APIResponse>, url = `${origin}/start`): Route {
    return {
        request: () => ({ url: () => url, method: () => 'GET', headers: () => ({}), postDataBuffer: () => null }) as unknown as Request,
        fetch: () => pending,
        abort: async () => {},
        fulfill: async () => {},
    } as unknown as Route;
}

// Adapted from Terra's lateReview reproduction: only Playwright's transport is faked.
// A timer delivers the response/error after use() has returned, not before teardown.
test.each(['redirect', 'error', 'cap'] as const)('teardown waits for a late HTTP %s and fails', async (kind) => {
    const h = harness();
    const pending = deferred<APIResponse>();
    const route = pendingRoute(pending.promise);
    vi.mocked(h.context.request.fetch).mockResolvedValue(response(302, '/loop'));
    let active = Promise.resolve();
    try {
        await expect(runDeskGuardFixture(h.options, async () => {
            active = h.dispatch(route);
            // Model Playwright observing the returned callback promise, including its rejection.
            void active.catch(() => {});
            setTimeout(() => {
                if (kind === 'error') pending.reject(new Error('late transport failure'));
                else pending.resolve(response(302, kind === 'redirect' ? `${forbidden}/late` : '/loop'));
            }, 0);
        })).rejects.toThrow(kind === 'redirect' ? `${forbidden}/late` : kind === 'cap' ? 'too many redirects' : 'late transport failure');
        expect(h.page.close).toHaveBeenCalled();
        expect(h.context.unrouteAll).toHaveBeenCalled();
    } finally {
        await active.catch(() => {});
    }
});

test('a late WebSocket callback error is collected alongside its refusal', async () => {
    const h = harness();
    const pending = deferred<void>();
    let active = Promise.resolve();
    h.page.close.mockImplementation(async () => {
        active = h.refuseSocket(() => pending.promise);
        void active.catch(() => {});
        setTimeout(() => pending.reject(new Error('late socket close failure')), 0);
    });
    try {
        await expect(runDeskGuardFixture(h.options, async () => {})).rejects.toThrow('late socket close failure');
    } finally {
        pending.resolve();
        await active.catch(() => {});
    }
});

test('a long poll ending on a closed target passes only after page closure and handler completion', async () => {
    const h = harness();
    const pending = deferred<APIResponse>();
    let active = Promise.resolve();
    const events: string[] = [];
    h.page.close.mockImplementation(async () => {
        events.push('close');
        pending.reject(new Error('route.fetch: Target page, context or browser has been closed'));
    });
    h.context.unrouteAll.mockImplementation(async () => { events.push('unroute'); });
    try {
        await expect(runDeskGuardFixture(h.options, async () => {
            active = h.dispatch(pendingRoute(pending.promise)).then(() => { events.push('settled'); });
            events.push('use');
        })).resolves.toBeUndefined();
        expect(events).toEqual(['use', 'close', 'settled', 'unroute']);
    } finally {
        pending.resolve(response(200));
        await active;
    }
});

test('a long poll stays pending until request-client disposal and teardown awaits disposal and the handler', async () => {
    vi.useFakeTimers();
    const h = harness();
    const pending = deferred<APIResponse>();
    const events: string[] = [];
    let active = Promise.resolve();
    h.page.close.mockImplementation(async () => { events.push('close'); });
    vi.mocked(h.context.request.dispose).mockImplementation(async () => {
        events.push('dispose');
        // Only this transport owner can end the request, not page.close().
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        pending.reject(new Error('route.fetch: Target page, context or browser has been closed'));
        events.push('disposed');
    });
    h.context.unrouteAll.mockImplementation(async () => { events.push('unroute'); });
    try {
        const result = runDeskGuardFixture(h.options, async () => {
            active = h.dispatch(pendingRoute(pending.promise)).then(() => { events.push('settled'); });
            events.push('use');
        });
        const assertion = expect(result).resolves.toBeUndefined();
        void assertion.catch(() => {});
        await vi.advanceTimersByTimeAsync(5_000);
        await assertion;
        expect(events).toEqual(['use', 'close', 'dispose', 'disposed', 'settled', 'unroute']);
        expect(h.context.request.dispose).toHaveBeenCalledWith();
    } finally {
        pending.resolve(response(200));
        await active;
        vi.useRealTimers();
    }
});

test('a request-client disposal failure still reports completed refusals', async () => {
    const h = harness();
    vi.mocked(h.context.request.dispose).mockRejectedValue(new Error('request client disposal failed'));
    await expect(runDeskGuardFixture(h.options, async () => { await h.refuse(); })).rejects.toThrow(
        new RegExp(`request client disposal failed[\\s\\S]*${forbidden}/probe`),
    );
});

test.each(['http', 'websocket'] as const)('a stuck %s callback fails within the teardown bound and names its URL', async (transport) => {
    vi.useFakeTimers();
    const h = harness();
    const pending = deferred<APIResponse>();
    const url = transport === 'http' ? `${origin}/stuck` : `${forbidden.replace('http:', 'ws:')}/socket`;
    let active = Promise.resolve();
    try {
        const result = runDeskGuardFixture(h.options, async () => {
            active = transport === 'http'
                ? h.dispatch(pendingRoute(pending.promise, url))
                : h.refuseSocket(() => pending.promise.then(() => {}));
        });
        const assertion = expect(result).rejects.toThrow(new RegExp(`stuck.*${url}`));
        void assertion.catch(() => {});
        let settled = false;
        void result.finally(() => { settled = true; }).catch(() => {});
        await vi.advanceTimersByTimeAsync(4_999);
        expect(settled).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        await assertion;
        expect(h.page.close).toHaveBeenCalled();
        expect(h.context.unrouteAll).not.toHaveBeenCalled();
    } finally {
        pending.resolve(response(200));
        await active;
        vi.useRealTimers();
    }
});

test('a failed page close fails teardown and leaves the guards installed', async () => {
    const h = harness();
    h.page.close.mockRejectedValue(new Error('page close transport failure'));
    await expect(runDeskGuardFixture(h.options, async () => {})).rejects.toThrow('page close transport failure');
    expect(h.context.unrouteAll).not.toHaveBeenCalled();
});
