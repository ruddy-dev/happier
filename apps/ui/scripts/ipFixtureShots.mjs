#!/usr/bin/env node
// Serve a flag-on web export and shoot the dev-only desk fixture route in system Chrome.
// Usage: node scripts/ipFixtureShots.mjs <export-dir> <out-dir> [chrome-path]   (run from apps/ui)
// Sheet: append --sheet <mockup-12-dir>. All captures and index.html go under out-dir.
// - Static server on a random 127.0.0.1 port, offline /v1/features and JSON API 404s, SPA fallback for pages.
//   The runtime config points the app's
//   server at that same origin, so nothing defaults to a hosted server.
// - Network guard (installNetworkGuard): any http(s) request to a host other than 127.0.0.1, localhost or [::1]
//   is aborted before it leaves the browser (context.route); any ws(s) connection to such a host is closed
//   without ever being opened (context.routeWebSocket, since route() does not see WebSockets). Both fail the run.
// - Reduced motion, a frozen clock, no GPU; shots at 1440x900 (also with the approvals drawer open) and 390x844.
import { createServer } from 'node:http';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
const NETWORK_PROTOCOLS = new Set(['http:', 'https:', 'ws:', 'wss:']);

// App key -> mockup-12/scripts/shoot.js THEMES + hashOf. Keep the correspondence in one place.
export const THEME_MAP = Object.freeze(Object.fromEntries([
    ['night', 'slip', 'dark', 'dark'], ['paper', 'slip', 'light', 'light'],
    ['tokyo', 'term', 'tokyo', 'dark'], ['kanagawa', 'term', 'kanagawa', 'dark'],
    ['gruvbox', 'term', 'gruvbox', 'dark'], ['dracula', 'term', 'dracula', 'dark'],
    ['terminalPaper', 'term', 'paper', 'light'],
].map(([key, style, variant, mode]) => [key, Object.freeze({
    style, variant, mode, hash: `#${style}${variant === 'dark' || variant === 'tokyo' ? '' : `-${variant}`}`,
})])));

const EXTRA_PAGES = [
    { page: 'sign-in', label: 'Sign-in', appPath: '/', readyTestId: 'welcome-secondary-login',
        mockupGap: 'Mockup 12 has no sign-in page.' },
    { page: 'restore', label: 'Secret-key restore', appPath: '/restore/manual', readyTestId: 'restore-manual-secret-input',
        mockupGap: 'Mockup 12 has no secret-key restore page.' },
    { page: 'voice', label: 'Settings > Voice', appPath: '/settings/voice', mockupSection: '#voT',
        appGap: 'Auth required for /settings/voice. The signed-out fixture cannot render this page.' },
    { page: 'robots', label: 'Settings > Robots', appPath: '/desk/settings', mockupSection: '#rbT',
        appGap: 'Auth required for /desk/settings. Leaving the fixture does not authorize the Robots page.' },
];

export function buildShotMatrix(mode = 'legacy') {
    if (mode === 'legacy') return [
        ['1440', 1440, 900, false], ['1440-approvals', 1440, 900, true], ['390', 390, 844, false],
    ].map(([name, width, height, openApprovals]) => ({
        name, width, height, openApprovals, page: 'desk', appPath: ROUTE,
        appImage: `p0-6-desk-fixture-${name}.png`,
    }));
    if (mode !== 'sheet') throw new Error(`Unknown shot mode: ${mode}`);
    return Object.entries(THEME_MAP).flatMap(([theme, mapping]) =>
        [[1440, 900], [1100, 800], [390, 844]].flatMap(([width, height]) => {
            const pages = [{ page: 'desk', label: 'Desk fixture', appPath: ROUTE }];
            if ((theme === 'night' || theme === 'paper') && width !== 1100) pages.push(...EXTRA_PAGES);
            return pages.map(page => {
                const name = `${theme}-${width}-${page.page}`;
                return { ...page, theme, width, height, name, openApprovals: false, mockupHash: mapping.hash,
                    appImage: `app/${name}.png`, mockupImage: `mockup/${name}.png`,
                    note: page.page === 'desk' && mapping.style === 'term'
                        ? 'Terminal palette is seeded through desk prefs. Current app chrome still uses the light/dark profile.'
                        : page.page === 'sign-in' && width === 390
                            ? 'Phone sign-in shows the form after "Get started". The brand hero is not pictured.' : '',
                };
            });
        }));
}

/** react-native-mmkv 3.3.3 createMMKV.web.ts prefixes keys with "mmkv.default\\".
 * persistence.ts reads local-settings; deskPrefs.ts reads the two string preferences below.
 * Fresh browser contexts have no credentials. Do not seed account/auth state here.
 */
export function buildStorageSeed(theme) {
    const mapping = THEME_MAP[theme];
    if (!mapping) throw new Error(`Unknown desk theme: ${theme}`);
    return {
        'mmkv.default\\local-settings': JSON.stringify({
            themePreference: mapping.mode,
            themeProfiles: { profiles: [], activeProfileIds: { light: 'ignorePreviousLight', dark: 'ignorePrevious' } },
        }),
        'mmkv.default\\ignorePrevious.chatStyle': mapping.style === 'term' ? 'terminal' : 'mask',
        'mmkv.default\\ignorePrevious.terminalPalette': mapping.style === 'term' ? theme : 'tokyo',
    };
}

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

export function renderSheetHtml(shots) {
    const cell = (shot, side, label) => {
        const error = shot[`${side}Error`];
        const gap = error || shot[`${side}Gap`];
        const failureImage = error && shot[`${side}FailureImage`];
        return `<figure><figcaption>${label}</figcaption>${gap
            ? `<p class="gap">${error ? 'FAIL' : 'Gap'}: ${escapeHtml(gap)}${failureImage ? `<br><a href="${escapeHtml(failureImage)}">Failure screenshot</a>` : ''}</p>`
            : `<a href="${escapeHtml(shot[`${side}Image`])}"><img src="${escapeHtml(shot[`${side}Image`])}" width="${shot.width}" height="${shot.height}" alt="${escapeHtml(`${label}: ${shot.label}, ${shot.theme}, ${shot.width}x${shot.height}`)}" loading="lazy"></a>`}</figure>`;
    };
    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Phase 1 desk comparisons</title><style>
body { margin: 24px; font: 16px system-ui, sans-serif; color: #202124; background: #eee; }
h1 { font-size: 24px; } h2 { font-size: 18px; } section { margin: 32px 0; }
.pair { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 16px; }
figure { margin: 0; min-width: 0; background: white; } figcaption { padding: 8px; font-weight: bold; }
img { display: block; width: 100%; height: auto; } .gap { padding: 16px; } .note { max-width: 90ch; }
a { color: inherit; } </style></head><body>
<h1>Phase 1 desk comparisons</h1>
<p>App on the left, mockup 12 on the right. Click an image for its original size. Labels name the requested theme and viewport.</p>
${shots.map(shot => `<section id="${escapeHtml(shot.name)}"><h2>${escapeHtml(shot.theme)} · ${shot.width}x${shot.height} · ${escapeHtml(shot.label)}</h2>
${shot.note ? `<p class="note">${escapeHtml(shot.note)}</p>` : ''}
<div class="pair">${cell(shot, 'app', 'App')}${cell(shot, 'mockup', 'Mockup 12')}</div></section>`).join('\n')}
</body></html>\n`;
}

/** True for a request the shot run must not make. Unparseable URLs count as forbidden. */
export function isForbiddenRequestUrl(raw) {
    let url;
    try {
        url = new URL(raw);
    } catch {
        return true;
    }
    return NETWORK_PROTOCOLS.has(url.protocol) && !LOCAL_HOSTS.has(url.hostname);
}

/** Aborts non-local HTTP(S) and closes non-local WebSockets on `context`, recording each in `blocked`. */
export async function installNetworkGuard(context, blocked) {
    await context.route('**/*', (route) => {
        const request = route.request();
        if (isForbiddenRequestUrl(request.url())) {
            blocked.push(`${request.method()} ${new URL(request.url()).origin}`);
            return route.abort('blockedbyclient');
        }
        return route.continue();
    });
    // A handler that never calls connectToServer() keeps the socket from opening at all.
    await context.routeWebSocket('**/*', (ws) => {
        if (isForbiddenRequestUrl(ws.url())) {
            blocked.push(`WS ${ws.url()}`);
            ws.close();
            return;
        }
        ws.connectToServer();
    });
}

/** The decoded path, or null when it holds a malformed escape (the static server answers 400 then). */
export function decodeRequestPath(pathname) {
    try {
        return decodeURIComponent(pathname);
    } catch {
        return null;
    }
}

const FIXED_TIME = new Date('2026-11-01T14:02:00Z');
const ROUTE = '/dev/desk-fixture';
// Key-only subset of createWelcomeFeaturesResponse, validated against FeaturesResponseSchema in the tests.
// This advertises signed-out controls only. All authentication writes still receive a JSON 404.
const OFFLINE_FEATURES = {
    features: { auth: { login: { keyChallenge: { enabled: true } } } },
    capabilities: {
        auth: {
            methods: [{
                id: 'key_challenge',
                actions: [{ id: 'login', enabled: true, mode: 'keyed' }, { id: 'provision', enabled: true, mode: 'keyed' }],
                ui: { displayName: 'Device key', iconHint: null },
            }],
            signup: { methods: [{ id: 'anonymous', enabled: true }] },
            login: { methods: [{ id: 'key_challenge', enabled: true }], requiredProviders: [] },
            recovery: { providerReset: { providers: [] } },
            ui: { autoRedirect: { enabled: false, providerId: null } },
            providers: {},
            misconfig: [],
        },
    },
};
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
    '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.ttf': 'font/ttf', '.woff': 'font/woff',
    '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.map': 'application/json' };

export function createStaticServer(dist) {
    const indexHtml = readFileSync(join(dist, 'index.html'), 'utf8');
    const served = [];
    const server = createServer((req, res) => {
        const url = new URL(req.url ?? '/', 'http://127.0.0.1');
        served.push(url.pathname);
        const decoded = url.pathname === '/' ? '/index.html' : decodeRequestPath(url.pathname);
        if (decoded === null) {
            res.writeHead(400).end('Bad Request');
            return;
        }
        if (decoded === '/v1' || decoded.startsWith('/v1/')) {
            const features = req.method === 'GET' && decoded === '/v1/features';
            res.writeHead(features ? 200 : 404, { 'content-type': MIME['.json'], 'cache-control': 'no-store' });
            res.end(JSON.stringify(features ? OFFLINE_FEATURES : { error: 'not_found' }));
            return;
        }
        const file = resolve(dist, `.${decoded}`);
        const inside = file === dist || file.startsWith(`${dist}/`);
        if (inside && existsSync(file) && statSync(file).isFile() && !file.endsWith('index.html')) {
            res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
            createReadStream(file).pipe(res);
            return;
        }
        if (extname(url.pathname) && !file.endsWith('index.html')) {
            res.writeHead(404).end('Not Found');
            return;
        }
        const origin = `http://127.0.0.1:${server.address().port}`;
        const boot = `<script>window.__HAPPIER_WEB_RUNTIME_CONFIG__=${JSON.stringify({ serverUrl: origin })};</script>`;
        const i = indexHtml.toLowerCase().indexOf('</head>');
        res.writeHead(200, { 'content-type': MIME['.html'], 'cache-control': 'no-store' });
        res.end(i >= 0 ? indexHtml.slice(0, i) + boot + indexHtml.slice(i) : boot + indexHtml);
    });
    return { server, served };
}

function startStatic(dist) {
    const host = createStaticServer(dist);
    return new Promise((ok, fail) => host.server.once('error', fail).listen(0, '127.0.0.1', () => ok(host)));
}

export async function waitForAppReady(page, shot) {
    const relayError = page.getByText('Relay not supported', { exact: false }).first();
    const unsupported = () => new Error(`Relay not supported on ${shot.appPath ?? shot.page}; the requested page did not load`);
    const ready = async () => {
        if (shot.page !== 'desk') {
            if (shot.page === 'sign-in' && shot.width === 390) {
                const getStarted = page.getByTestId('brand-hero-get-started');
                await getStarted.waitFor({ state: 'visible', timeout: 60_000 });
                await getStarted.click();
            }
            await page.getByTestId(shot.readyTestId).waitFor({ state: 'visible', timeout: 60_000 });
            return;
        }
        // The 390 shot opens on Coordinator. Work stays mounted behind its phone tab.
        const state = shot.width === 390 ? 'attached' : 'visible';
        await page.getByTestId('ip-work').waitFor({ state, timeout: 60_000 });
        await page.getByText('ABC-12', { exact: false }).first().waitFor({ state, timeout: 30_000 });
        await page.getByTestId('ip-fixture-coordinator-body').waitFor({ state: 'visible', timeout: 30_000 });
    };
    try {
        await Promise.race([
            ready(),
            // Observe until this row's context closes; only the existing readiness waits own its deadline.
            relayError.waitFor({ state: 'visible', timeout: 0 }).then(() => { throw unsupported(); }),
        ]);
    } catch (error) {
        if (await relayError.isVisible()) throw unsupported();
        throw error;
    }
    if (await relayError.isVisible()) throw unsupported();
}

async function captureApp(page, shot, origin) {
    await page.goto(`${origin}${shot.appPath}`, { waitUntil: 'load', timeout: 90_000 });
    await waitForAppReady(page, shot);
    if (shot.openApprovals) await page.getByTestId('ip-approvals-open').click();
    await page.clock.runFor(1000);
    await page.evaluate(() => document.fonts.ready);
    const facts = await page.evaluate(() => ({
        path: location.pathname,
        sideways: document.documentElement.scrollWidth > innerWidth + 1,
        restorePrompt: document.body.innerText.includes('Restore with Secret Key'),
        relayUnsupported: document.body.innerText.includes('Relay not supported'),
        testIds: [...new Set([...document.querySelectorAll('[data-testid^="ip-"]')].map(e => e.getAttribute('data-testid')))],
    }));
    if (facts.path !== shot.appPath) throw new Error(`Redirected from ${shot.appPath} to ${facts.path}`);
    if (facts.relayUnsupported) throw new Error(`Relay not supported on ${shot.appPath}`);
    if (shot.page === 'desk' && facts.restorePrompt) throw new Error('Account prompt shown instead of fixture coordinator');
    return facts;
}

async function captureMockup(page, shot, origin) {
    await page.goto(`${origin}/${shot.mockupHash}`, { waitUntil: 'load', timeout: 90_000 });
    await page.locator('#app').waitFor({ state: 'visible' });
    const mapping = THEME_MAP[shot.theme];
    const theme = await page.evaluate(() => ({ ...document.documentElement.dataset }));
    if (theme.style !== mapping.style || theme.v !== mapping.variant) {
        throw new Error(`Mockup theme mismatch: ${JSON.stringify(theme)}`);
    }
    if (shot.mockupSection) {
        await page.locator('#setBtn').click();
        await page.locator('#settings').waitFor({ state: 'visible' });
        await page.locator(shot.mockupSection).scrollIntoViewIfNeeded();
    }
    await page.clock.runFor(1000);
    await page.evaluate(() => document.fonts.ready);
    return { hash: shot.mockupHash, section: shot.mockupSection ?? 'desk' };
}

export async function captureShot(page, shot, side, origin, out) {
    try {
        const facts = side === 'app' ? await captureApp(page, shot, origin) : await captureMockup(page, shot, origin);
        await page.screenshot({ path: join(out, shot[`${side}Image`]), animations: 'disabled', caret: 'hide' });
        return facts;
    } catch (error) {
        shot[`${side}Error`] = error.message;
        const failureImage = shot[`${side}Image`].replace(/\.png$/, '-FAIL.png');
        try {
            await page.screenshot({ path: join(out, failureImage), animations: 'disabled', caret: 'hide' });
            shot[`${side}FailureImage`] = failureImage;
        } catch (screenshotError) {
            shot[`${side}Error`] += `; failure screenshot unavailable: ${screenshotError.message}`;
        }
        throw error;
    }
}

async function main() {
    const args = process.argv.slice(2);
    const sheetIndex = args.indexOf('--sheet');
    const mockupArg = sheetIndex < 0 ? null : args[sheetIndex + 1];
    if (sheetIndex >= 0) args.splice(sheetIndex, 2);
    const [distArg, outArg, chromeArg] = args;
    if (!distArg || !outArg || args.length > 3 || args.some(arg => arg.startsWith('--')) || (sheetIndex >= 0 && !mockupArg)) {
        console.error('usage: ipFixtureShots.mjs <export-dir> <out-dir> [chrome-path] [--sheet <mockup-12-dir>]');
        process.exitCode = 2;
        return;
    }
    const dist = resolve(distArg);
    const out = resolve(outArg);
    const chromePath = chromeArg ?? process.env.IP_CHROME_PATH ?? '/usr/bin/google-chrome';
    // packages/tests owns the pinned dependency; resolution must not depend on the invoking cwd.
    const { chromium } = createRequire(new URL('../../../packages/tests/package.json', import.meta.url))('playwright-core');

    const shots = buildShotMatrix(mockupArg ? 'sheet' : 'legacy');
    const servers = [];
    const blocked = [];
    const pageErrors = [];
    const consoleErrors = [];
    let browser;
    let failed = false;
    try {
        await mkdir(out, { recursive: true });
        const appHost = await startStatic(dist);
        servers.push(appHost);
        const origin = `http://127.0.0.1:${appHost.server.address().port}`;
        let mockupOrigin;
        if (mockupArg) {
            const mockupHost = await startStatic(resolve(mockupArg));
            servers.push(mockupHost);
            mockupOrigin = `http://127.0.0.1:${mockupHost.server.address().port}`;
            await mkdir(join(out, 'app'), { recursive: true });
            await mkdir(join(out, 'mockup'), { recursive: true });
        }
        browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ['--disable-gpu'] });
        console.log(`chrome ${browser.version()} at ${chromePath}; serving ${dist} on ${origin}`);
        for (const shot of shots) for (const side of mockupArg ? ['app', 'mockup'] : ['app']) {
            if (shot[`${side}Gap`]) {
                console.log(`GAP ${shot.name} ${side}: ${shot[`${side}Gap`]}`);
                continue;
            }
            const context = await browser.newContext({ viewport: { width: shot.width, height: shot.height },
                colorScheme: shot.theme ? THEME_MAP[shot.theme].mode : 'light',
                reducedMotion: 'reduce', serviceWorkers: 'block' });
            try {
                await installNetworkGuard(context, blocked);
                if (side === 'app' && shot.theme) {
                    await context.addInitScript(seed => {
                        for (const [key, value] of Object.entries(seed)) localStorage.setItem(key, value);
                    }, buildStorageSeed(shot.theme));
                }
                const page = await context.newPage();
                const name = `${shot.name} ${side}`;
                page.on('pageerror', e => { pageErrors.push(`${name}: ${e.message}`); });
                page.on('console', m => { if (m.type() === 'error') consoleErrors.push(`${name}: ${m.text().slice(0, 300)}`); });
                await page.clock.install({ time: FIXED_TIME });
                await page.clock.setFixedTime(FIXED_TIME);
                const started = Date.now();
                const facts = await captureShot(page, shot, side, side === 'app' ? origin : mockupOrigin, out);
                const file = join(out, shot[`${side}Image`]);
                console.log(`${name}: ${Date.now() - started} ms; ${JSON.stringify(facts)} -> ${file}`);
            } catch (error) {
                failed = true;
                shot[`${side}Error`] ??= error.message;
                console.log(`FAIL ${shot.name} ${side}: ${error.stack ?? error}`);
            } finally {
                await context.close();
            }
        }
    } catch (e) {
        failed = true;
        // If setup failed, the sheet must not refer to missing or previous-run images as successes.
        for (const shot of shots) for (const side of ['app', 'mockup']) {
            if (!shot[`${side}Gap`]) shot[`${side}Error`] = `Run interrupted: ${e.message}`;
        }
        console.log(`FAIL: ${e.stack ?? e}`);
    } finally {
        try {
            await browser?.close();
        } finally {
            for (const { server } of servers) {
                server.close();
                server.closeAllConnections?.();
            }
        }
        if (mockupArg) {
            await writeFile(join(out, 'index.html'), renderSheetHtml(shots));
            console.log(`sheet: ${join(out, 'index.html')}`);
        }
    }
    const served = servers.flatMap(host => host.served);
    console.log(`served ${served.length} requests; local API-ish paths: ${JSON.stringify([...new Set(served.filter((p) => p.startsWith('/v') || p.includes('socket')))].slice(0, 20))}`);
    console.log(`blocked non-local requests: ${blocked.length}${blocked.length ? '\n  ' + [...new Set(blocked)].join('\n  ') : ''}`);
    console.log(`page errors: ${pageErrors.length}${pageErrors.length ? '\n  ' + pageErrors.join('\n  ') : ''}`);
    console.log(`console errors: ${consoleErrors.length}${consoleErrors.length ? '\n  ' + [...new Set(consoleErrors)].slice(0, 15).join('\n  ') : ''}`);
    if (blocked.length) failed = true;
    if (pageErrors.length) failed = true;
    process.exitCode = failed ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
