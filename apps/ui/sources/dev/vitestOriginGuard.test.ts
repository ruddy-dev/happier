import { describe, expect, it, vi } from 'vitest';

import { guardFetch, guardWebSocket } from './vitestOriginGuard';

// Probe hosts that are forbidden but unreal: before the guard is installed a request to them fails
// on DNS and never reaches a real server.
const PROBE_HTTP = 'https://desk-guard-probe.ts.net/v1/sessions';
const PROBE_WS = 'wss://desk-guard-probe.ts.net/v1/updates';

describe('vitest origin guard', () => {
    it('GUARD-fetch: refuses the developer server, hosted Happier and tailnet hosts before any request', async () => {
        const underlying = vi.fn(async () => new Response('ok'));
        const guarded = guardFetch(underlying as unknown as typeof fetch);
        for (const url of ['http://127.0.0.1:3005/v1/sessions', 'http://localhost:3005/', 'https://api.happier.dev/v1/account', PROBE_HTTP]) {
            await expect(guarded(url)).rejects.toThrow(/forbidden origin/);
            await expect(guarded(new URL(url))).rejects.toThrow(/forbidden origin/);
        }
        expect(underlying).not.toHaveBeenCalled();
    });

    it('GUARD-fetch-3005: refuses port 3005 on any host, including IPv6 loopback and LAN addresses', async () => {
        const underlying = vi.fn(async () => new Response('ok'));
        const guarded = guardFetch(underlying as unknown as typeof fetch);
        for (const url of ['http://[::1]:3005/v1/sessions', 'http://[::ffff:7f00:1]:3005/', 'http://192.168.1.5:3005/v1/sessions']) {
            await expect(guarded(url)).rejects.toThrow(/forbidden origin/);
        }
        expect(underlying).not.toHaveBeenCalled();
    });

    it('GUARD-fetch-request: refuses a Request object aimed at a forbidden origin', async () => {
        const underlying = vi.fn(async () => new Response('ok'));
        const guarded = guardFetch(underlying as unknown as typeof fetch);
        await expect(guarded(new Request('https://api.happier.dev/x'))).rejects.toThrow(/forbidden origin/);
        expect(underlying).not.toHaveBeenCalled();
    });

    it('GUARD-fetch-allowed: other origins pass through unchanged', async () => {
        const underlying = vi.fn(async () => new Response('ok'));
        const guarded = guardFetch(underlying as unknown as typeof fetch);
        const init = { method: 'POST' };
        await guarded('http://127.0.0.1:4005/v1/sessions', init);
        expect(underlying).toHaveBeenCalledWith('http://127.0.0.1:4005/v1/sessions', init);
    });

    it('GUARD-websocket: refuses forbidden origins and constructs the rest', () => {
        const constructed: string[] = [];
        class FakeSocket {
            constructor(url: string | URL) {
                constructed.push(String(url));
            }
        }
        const Guarded = guardWebSocket(FakeSocket as unknown as typeof WebSocket);
        expect(() => new Guarded('ws://127.0.0.1:3005/v1/updates')).toThrow(/forbidden origin/);
        expect(() => new Guarded(PROBE_WS)).toThrow(/forbidden origin/);
        new Guarded('ws://127.0.0.1:4005/v1/updates');
        expect(constructed).toEqual(['ws://127.0.0.1:4005/v1/updates']);
    });

    it('GUARD-installed: the test runtime fetch and WebSocket carry the guard', async () => {
        await expect(fetch(PROBE_HTTP)).rejects.toThrow(/forbidden origin/);
        let socket: WebSocket | null = null;
        try {
            expect(() => {
                socket = new WebSocket(PROBE_WS);
            }).toThrow(/forbidden origin/);
        } finally {
            (socket as WebSocket | null)?.close();
        }
    });
});
