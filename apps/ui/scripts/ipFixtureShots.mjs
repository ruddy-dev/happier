#!/usr/bin/env node
// Serve a flag-on web export and shoot the dev-only desk fixture route in system Chrome.
// Usage: node scripts/ipFixtureShots.mjs <export-dir> <out-dir> [chrome-path]   (run from apps/ui)
// - Static server on a random 127.0.0.1 port, SPA fallback to index.html. The runtime config points the app's
//   server at that same origin, so nothing defaults to a hosted server.
// - Request guard: any http(s)/ws(s) request to a host other than 127.0.0.1, localhost or [::1] is aborted
//   and fails the run.
// - Reduced motion, a frozen clock, no GPU; shots at 1440x900 (also with the approvals drawer open) and 390x844.
import { createServer } from 'node:http';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
const NETWORK_PROTOCOLS = new Set(['http:', 'https:', 'ws:', 'wss:']);

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

const FIXED_TIME = new Date('2026-11-01T14:02:00Z');
const ROUTE = '/dev/desk-fixture';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
    '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.ttf': 'font/ttf', '.woff': 'font/woff',
    '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.map': 'application/json' };

function startStatic(dist) {
    const indexHtml = readFileSync(join(dist, 'index.html'), 'utf8');
    const served = [];
    const server = createServer((req, res) => {
        const url = new URL(req.url ?? '/', 'http://127.0.0.1');
        served.push(url.pathname);
        const file = resolve(dist, `.${url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)}`);
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
    return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok({ server, served })));
}

async function main() {
    const [distArg, outArg, chromeArg] = process.argv.slice(2);
    if (!distArg || !outArg) {
        console.error('usage: ipFixtureShots.mjs <export-dir> <out-dir> [chrome-path]');
        process.exit(2);
    }
    const dist = resolve(distArg);
    const out = resolve(outArg);
    const chromePath = chromeArg ?? process.env.IP_CHROME_PATH ?? '/usr/bin/google-chrome';
    const { chromium } = createRequire(join(process.cwd(), 'package.json'))('playwright-core');

    const { server, served } = await startStatic(dist);
    const origin = `http://127.0.0.1:${server.address().port}`;
    await mkdir(out, { recursive: true });
    const blocked = [];
    const pageErrors = [];
    const consoleErrors = [];
    let browser;
    let failed = false;
    try {
        browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ['--disable-gpu'] });
        console.log(`chrome ${browser.version()} at ${chromePath}; serving ${dist} on ${origin}`);
        for (const [name, width, height, openApprovals] of [['1440', 1440, 900, false], ['1440-approvals', 1440, 900, true], ['390', 390, 844, false]]) {
            const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce', serviceWorkers: 'block' });
            await context.route('**/*', (route) => {
                const request = route.request();
                if (isForbiddenRequestUrl(request.url())) {
                    blocked.push(`${request.method()} ${new URL(request.url()).origin}`);
                    return route.abort('blockedbyclient');
                }
                return route.continue();
            });
            const page = await context.newPage();
            page.on('pageerror', (e) => pageErrors.push(`${name}: ${e.message}`));
            page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(`${name}: ${m.text().slice(0, 300)}`); });
            page.on('websocket', (ws) => { if (isForbiddenRequestUrl(ws.url())) blocked.push(`WS ${ws.url()}`); });
            await page.clock.install({ time: FIXED_TIME });
            const t = Date.now();
            await page.goto(`${origin}${ROUTE}`, { waitUntil: 'load', timeout: 90_000 });
            // Visible outcomes, not sleeps: the Work column with a fixture issue, and the stub coordinator body.
            await page.getByTestId('ip-work').waitFor({ state: 'visible', timeout: 60_000 });
            await page.getByText('ABC-12', { exact: false }).first().waitFor({ timeout: 30_000 });
            await page.getByTestId('ip-fixture-coordinator-body').waitFor({ state: 'visible', timeout: 30_000 });
            if (openApprovals) await page.getByTestId('ip-approvals-open').click();
            await page.clock.runFor(1000);
            const facts = await page.evaluate(() => ({
                path: location.pathname,
                sideways: document.documentElement.scrollWidth > innerWidth + 1,
                restorePrompt: document.body.innerText.includes('Restore with Secret Key'),
                testIds: [...new Set([...document.querySelectorAll('[data-testid^="ip-"]')].map((e) => e.getAttribute('data-testid')))],
            }));
            const file = join(out, `p0-6-desk-fixture-${name}.png`);
            await page.screenshot({ path: file, animations: 'disabled', caret: 'hide' });
            console.log(`${name}: ${Date.now() - t} ms to visible; ${JSON.stringify(facts)} -> ${file}`);
            if (facts.path !== ROUTE) { failed = true; console.log(`FAIL ${name}: redirected to ${facts.path}`); }
            if (facts.restorePrompt) { failed = true; console.log(`FAIL ${name}: the account prompt is showing, so the coordinator stub is not in place`); }
            await context.close();
        }
    } catch (e) {
        failed = true;
        console.log(`FAIL: ${e.message}`);
    } finally {
        await browser?.close();
        server.close();
        server.closeAllConnections?.();
    }
    console.log(`served ${served.length} requests; local API-ish paths: ${JSON.stringify([...new Set(served.filter((p) => p.startsWith('/v') || p.includes('socket')))].slice(0, 20))}`);
    console.log(`blocked non-local requests: ${blocked.length}${blocked.length ? '\n  ' + [...new Set(blocked)].join('\n  ') : ''}`);
    console.log(`page errors: ${pageErrors.length}${pageErrors.length ? '\n  ' + pageErrors.join('\n  ') : ''}`);
    console.log(`console errors: ${consoleErrors.length}${consoleErrors.length ? '\n  ' + [...new Set(consoleErrors)].slice(0, 15).join('\n  ') : ''}`);
    if (blocked.length) failed = true;
    process.exit(failed ? 1 : 0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
