/**
 * Keeps desk tests off real servers. A test that reaches the developer's own server, the hosted
 * Happier API or a tailnet host could read or change real sessions, so those are refused outright,
 * even when a test lists them as allowed.
 *
 * No imports: `originGuard.test.mjs` and `scripts/desk-env.mjs` load this file through Node's
 * type stripping, without a build step.
 */

export type ForbiddenOriginPattern = Readonly<{ label: string; test: (url: URL) => boolean }>;

/**
 * The port a developer's own Happier server listens on. It is refused on every host, since the
 * same server is reachable through IPv6, IPv4-mapped, LAN and tailnet addresses as well as loopback.
 */
const LOCAL_SERVER_PORT = 3005;

export const FORBIDDEN_ORIGIN_PATTERNS: readonly ForbiddenOriginPattern[] = [
    {
        label: `the developer's own server (port ${LOCAL_SERVER_PORT})`,
        test: (url) => url.port === String(LOCAL_SERVER_PORT),
    },
    {
        label: 'hosted Happier (*.happier.dev)',
        test: (url) => url.hostname === 'happier.dev' || url.hostname.endsWith('.happier.dev'),
    },
    {
        label: 'a tailnet host (*.ts.net)',
        test: (url) => url.hostname.endsWith('.ts.net'),
    },
];

/** The forbidden class a URL falls in, or null. */
export function forbiddenOriginLabel(url: string, extraForbidden: readonly string[] = []): string | null {
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return null;
    }
    return FORBIDDEN_ORIGIN_PATTERNS.find((pattern) => pattern.test(parsed))?.label ?? null;
}

/**
 * Whether a request may leave the browser or test process. Allowed entries are matched by host and
 * port, so the test server's http and websocket URLs are one entry.
 */
export function isAllowedOrigin(url: string, allowed: readonly string[], extraForbidden: readonly string[] = []): boolean {
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return false;
    }
    if (FORBIDDEN_ORIGIN_PATTERNS.some((pattern) => pattern.test(parsed))) return false;
    return allowed.some((entry) => {
        try {
            return new URL(entry).host === parsed.host;
        } catch {
            return false;
        }
    });
}

/**
 * Variables that point the app or CLI somewhere: a server URL, an account, a home folder. `HAPPY_*`
 * covers the upstream Happy CLI's names, such as `HAPPY_SERVER_URL`.
 */
const SCRUBBED_PREFIXES = [/^HAPPIER_/, /^HAPPY_/, /^EXPO_PUBLIC_/];

/** Test switches (`HAPPIER_E2E_*` and their older `HAPPY_E2E_*` aliases) survive the scrub; they configure the harness, not the app. */
export const DESK_ENV_KEEP: readonly RegExp[] = [/^HAPPIER_E2E_/, /^HAPPY_E2E_/];

/** A copy of `env` without `HAPPIER_*`, `HAPPY_*` and `EXPO_PUBLIC_*`, except names matching `keep`. */
export function scrubEnv(env: NodeJS.ProcessEnv, keep: readonly RegExp[]): NodeJS.ProcessEnv {
    const next: NodeJS.ProcessEnv = {};
    for (const [name, value] of Object.entries(env)) {
        const scrubbed = SCRUBBED_PREFIXES.some((prefix) => prefix.test(name)) && !keep.some((pattern) => pattern.test(name));
        if (!scrubbed) next[name] = value;
    }
    return next;
}

/** Test servers pick a random port; this catches an explicit override onto the developer's server. */
export function assertServerPort(port: number): void {
    if (port === LOCAL_SERVER_PORT) {
        throw new Error(`Refusing to run a test server on port ${LOCAL_SERVER_PORT}: that is the developer's own Happier server.`);
    }
}
