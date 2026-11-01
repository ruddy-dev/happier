/**
 * Keeps UI unit tests off real servers: fetch and WebSocket refuse the developer's own server
 * (loopback port 3005), hosted Happier (*.happier.dev) and tailnet hosts (*.ts.net). A test that
 * reached one could read or change real sessions.
 *
 * The same list guards the browser tests in `packages/tests/src/testkit/deskTest/originGuard.ts`.
 * The UI cannot import from packages/tests, so the list is repeated here; change both together.
 */

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '0.0.0.0']);

function forbiddenReason(url: URL): string | null {
    if (url.port === '3005' && LOOPBACK_HOSTS.has(url.hostname)) return "the developer's own server";
    if (url.hostname === 'happier.dev' || url.hostname.endsWith('.happier.dev')) return 'hosted Happier';
    if (url.hostname.endsWith('.ts.net')) return 'a tailnet host';
    return null;
}

function urlOf(input: RequestInfo | URL | string): string {
    if (typeof input === 'string') return input;
    if (input instanceof URL) return input.href;
    return input.url;
}

/** Throws when a test would reach a forbidden origin; relative or unparsable URLs pass. */
function assertAllowed(rawUrl: string): void {
    let url: URL;
    try {
        url = new URL(rawUrl);
    } catch {
        return;
    }
    const reason = forbiddenReason(url);
    if (reason) throw new Error(`[vitest] forbidden origin (${reason}): ${rawUrl}`);
}

const GUARDED = Symbol.for('happier.vitestOriginGuard');

export function guardFetch(underlying: typeof fetch): typeof fetch {
    const guarded = (async (input: RequestInfo | URL, init?: RequestInit) => {
        assertAllowed(urlOf(input));
        return underlying(input, init);
    }) as typeof fetch;
    return Object.assign(guarded, { [GUARDED]: true });
}

export function guardWebSocket(Underlying: typeof WebSocket): typeof WebSocket {
    class GuardedWebSocket extends Underlying {
        constructor(url: string | URL, protocols?: string | string[]) {
            assertAllowed(String(url));
            super(url, protocols);
        }
    }
    return Object.assign(GuardedWebSocket, { [GUARDED]: true });
}

function isGuarded(value: unknown): boolean {
    return typeof value === 'function' && (value as unknown as Record<symbol, unknown>)[GUARDED] === true;
}

/**
 * Wraps the runtime's fetch and WebSocket once per worker. It assigns rather than `vi.stubGlobal`s,
 * so `vi.unstubAllGlobals()` after a test that stubbed fetch restores the guarded version.
 */
export function installOriginGuard(): void {
    const g = globalThis as { fetch?: typeof fetch; WebSocket?: typeof WebSocket };
    if (typeof g.fetch === 'function' && !isGuarded(g.fetch)) g.fetch = guardFetch(g.fetch);
    if (typeof g.WebSocket === 'function' && !isGuarded(g.WebSocket)) g.WebSocket = guardWebSocket(g.WebSocket);
}
