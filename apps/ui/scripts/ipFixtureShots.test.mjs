import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { runInNewContext } from 'node:vm';
import { tsImport } from 'tsx/esm/api';
import { decodeRequestPath, installNetworkGuard, isForbiddenRequestUrl } from './ipFixtureShots.mjs';
import { buildShotMatrix, buildStorageSeed, captureShot, createStaticServer, renderSheetHtml, THEME_MAP, waitForAppReady } from './ipFixtureShots.mjs';

// Load the protocol owner directly, so stale workspace dist files cannot hide schema drift.
const { FeaturesResponseSchema } = await tsImport('../../../packages/protocol/src/features/payload/featuresResponseSchema.ts', import.meta.url);

function requestStatic(server, path, method = 'GET') {
    return new Promise((resolve, reject) => {
        const chunks = [];
        // HTTP transport boundary only. The server's real request handler runs without binding a socket.
        const response = new Writable({ write(chunk, _encoding, done) { chunks.push(chunk); done(); } });
        response.writeHead = (status, headers = {}) => {
            response.status = status;
            response.headers = headers;
            return response;
        };
        response.on('error', reject);
        response.on('finish', () => resolve(new Response(Buffer.concat(chunks), {
            status: response.status, headers: response.headers,
        })));
        server.emit('request', { url: path, method }, response);
    });
}

async function staticHost(t) {
    const dist = await mkdtemp(join(tmpdir(), 'ip-shots-'));
    t.after(() => rm(dist, { recursive: true, force: true }));
    await writeFile(join(dist, 'index.html'), '<html><head></head><body>SPA shell</body></html>');
    const { server } = createStaticServer(dist);
    server.address = () => ({ port: 1 });
    return server;
}

test('the static host serves a supported offline welcome contract', async t => {
    const server = await staticHost(t);
    const response = await requestStatic(server, '/v1/features');
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /application\/json/);
    const features = FeaturesResponseSchema.parse(await response.json());
    const auth = features.capabilities.auth;
    // Matches createWelcomeFeaturesResponse's key-only path. No OAuth/mTLS redirect or auth grant.
    assert.deepEqual(auth.signup.methods, [{ id: 'anonymous', enabled: true }]);
    assert.deepEqual(auth.login.methods, [{ id: 'key_challenge', enabled: true }]);
    assert.deepEqual(auth.methods, [{
        id: 'key_challenge',
        actions: [{ id: 'login', enabled: true, mode: 'keyed' }, { id: 'provision', enabled: true, mode: 'keyed' }],
        ui: { displayName: 'Device key', iconHint: null },
    }]);
    assert.deepEqual(auth.ui.autoRedirect, { enabled: false, providerId: null });
    assert.deepEqual(auth.providers, {});
    assert.deepEqual(features.capabilities.oauth.providers, {});
    assert.equal(features.features.auth.login.keyChallenge.enabled, true);
});

test('other API paths return JSON 404s, including auth writes, while app routes retain the SPA fallback', async t => {
    const server = await staticHost(t);
    for (const [method, path] of [['GET', '/v1/unknown'], ['GET', '/v1/unknown.json'],
        ['POST', '/v1/auth'], ['POST', '/v1/features']]) {
        const missing = await requestStatic(server, path, method);
        assert.equal(missing.status, 404, `${method} ${path}`);
        assert.match(missing.headers.get('content-type'), /application\/json/);
        assert.deepEqual(await missing.json(), { error: 'not_found' });
    }
    const route = await requestStatic(server, '/restore/manual');
    assert.match(route.headers.get('content-type'), /text\/html/);
    assert.match(await route.text(), /SPA shell/);
});

test('the default matrix preserves the three original fixture captures', () => {
    assert.deepEqual(buildShotMatrix().map(({ name, width, height, openApprovals, appImage }) =>
        [name, width, height, openApprovals, appImage]), [
        ['1440', 1440, 900, false, 'p0-6-desk-fixture-1440.png'],
        ['1440-approvals', 1440, 900, true, 'p0-6-desk-fixture-1440-approvals.png'],
        ['390', 390, 844, false, 'p0-6-desk-fixture-390.png'],
    ]);
});

test('one theme map uses mockup 12 THEMES/hashOf names, including both kinds of paper', () => {
    assert.deepEqual(Object.fromEntries(Object.entries(THEME_MAP).map(([key, value]) => [key, value.hash])), {
        night: '#slip', paper: '#slip-light', tokyo: '#term', kanagawa: '#term-kanagawa',
        gruvbox: '#term-gruvbox', dracula: '#term-dracula', terminalPaper: '#term-paper',
    });
});

test('the sheet matrix covers every theme and size, and extra pages in dark and light at 1440 and 390', () => {
    const shots = buildShotMatrix('sheet');
    assert.equal(shots.length, 37);
    assert.equal(new Set(shots.map(shot => shot.name)).size, shots.length);
    const themes = ['night', 'paper', 'tokyo', 'kanagawa', 'gruvbox', 'dracula', 'terminalPaper'];
    assert.deepEqual(shots.filter(shot => shot.page === 'desk').map(shot => [shot.theme, shot.width, shot.height]),
        themes.flatMap(theme => [[theme, 1440, 900], [theme, 1100, 800], [theme, 390, 844]]));
    for (const theme of ['night', 'paper']) for (const width of [1440, 390]) {
        assert.deepEqual(shots.filter(shot => shot.theme === theme && shot.width === width).map(shot => shot.page),
            ['desk', 'sign-in', 'restore', 'voice', 'robots']);
    }
    for (const shot of shots) {
        assert.equal(shot.mockupHash, THEME_MAP[shot.theme].hash);
        assert.match(shot.appImage, /^app\/[\w-]+\.png$/);
        assert.match(shot.mockupImage, /^mockup\/[\w-]+\.png$/);
        if (shot.page === 'desk') assert.equal(shot.appPath, '/dev/desk-fixture');
        if (shot.page === 'sign-in') {
            assert.equal(shot.appPath, '/');
            assert.equal(shot.readyTestId, 'welcome-secondary-login');
            assert.match(shot.mockupGap, /no sign-in/i);
        }
        if (shot.page === 'restore') {
            assert.equal(shot.appPath, '/restore/manual');
            assert.equal(shot.readyTestId, 'restore-manual-secret-input');
            assert.match(shot.mockupGap, /no secret-key/i);
        }
        if (shot.page === 'voice' || shot.page === 'robots') {
            assert.match(shot.appGap, /auth/i);
            assert.ok(shot.mockupSection);
        }
    }
    // Theme, then viewport, even for the supplementary pages.
    assert.deepEqual(shots.slice(0, 6).map(shot => [shot.theme, shot.width]),
        Array(5).fill(['night', 1440]).concat([['night', 1100]]));
});

test('storage seeds use MMKV web keys, the real profile shape and desk preferences without credentials', () => {
    for (const [theme, mode, style, palette] of [
        ['night', 'dark', 'mask', 'tokyo'], ['paper', 'light', 'mask', 'tokyo'],
        ['tokyo', 'dark', 'terminal', 'tokyo'], ['kanagawa', 'dark', 'terminal', 'kanagawa'],
        ['gruvbox', 'dark', 'terminal', 'gruvbox'], ['dracula', 'dark', 'terminal', 'dracula'],
        ['terminalPaper', 'light', 'terminal', 'terminalPaper'],
    ]) {
        const seed = buildStorageSeed(theme);
        assert.deepEqual(seed, {
            'mmkv.default\\local-settings': JSON.stringify({
                themePreference: mode,
                themeProfiles: { profiles: [], activeProfileIds: { light: 'ignorePreviousLight', dark: 'ignorePrevious' } },
            }),
            'mmkv.default\\ignorePrevious.chatStyle': style,
            'mmkv.default\\ignorePrevious.terminalPalette': palette,
        });
    }
    assert.throws(() => buildStorageSeed('unknown'), /unknown.*theme/i);
});

test('HTML pairs app left and mockup right using relative paths, and makes missing captures explicit', () => {
    const [row] = buildShotMatrix('sheet');
    const html = renderSheetHtml([{ ...row, label: 'Desk <test> & "label"' }]);
    assert.match(html, /<!doctype html>/i);
    assert.match(html, /Desk &lt;test&gt; &amp; &quot;label&quot;/);
    assert.ok(html.indexOf(`src="${row.appImage}"`) < html.indexOf(`src="${row.mockupImage}"`));
    assert.match(html, /night/);
    assert.match(html, /1440.*900/);
    assert.doesNotMatch(html, /<script|https?:\/\/|@import|@font-face/i);
    const unavailable = renderSheetHtml([{ ...row, appGap: 'Auth <blocked>', mockupGap: 'No matching page' }]);
    assert.match(unavailable, /Auth &lt;blocked&gt;/);
    assert.match(unavailable, /No matching page/);
    assert.doesNotMatch(unavailable, /<img/);
    const failed = renderSheetHtml([{ ...row, appError: 'Render failed', mockupError: 'Missing selector' }]);
    assert.match(failed, /Render failed/);
    assert.match(failed, /Missing selector/);
    assert.doesNotMatch(failed, /<img/);
    const failureImage = 'app/night-1440-sign-in-FAIL.png';
    const diagnosed = renderSheetHtml([{ ...row, appError: 'Relay <unsupported>', appFailureImage: failureImage }]);
    assert.match(diagnosed, /Relay &lt;unsupported&gt;/);
    assert.ok(diagnosed.includes(`href="${failureImage}"`));
    assert.ok(!diagnosed.includes(`src="${row.appImage}"`), 'a failure must not show a previous successful capture');
});

function readinessPage({ relayVisible = false, readyError } = {}) {
    const waits = [];
    const actions = [];
    const locator = id => ({
        first() { return this; },
        isVisible: async () => id === 'Relay not supported' && relayVisible,
        click: async () => { actions.push(['click', id]); },
        waitFor: async options => {
            if (id === 'Relay not supported') {
                if (relayVisible) return;
                return new Promise(() => {}); // Browser locator stays pending until ready or context close.
            }
            waits.push([id, options.state ?? 'visible']);
            actions.push(['wait', id, options.state ?? 'visible']);
            if (readyError) throw readyError;
        },
    });
    return { waits, actions, getByTestId: locator, getByText: locator };
}

test('signed-out readiness requires the real form rather than the shell', async () => {
    for (const shot of buildShotMatrix('sheet').filter(shot => ['sign-in', 'restore'].includes(shot.page))) {
        const page = readinessPage();
        await waitForAppReady(page, shot);
        const form = shot.page === 'sign-in' ? 'welcome-secondary-login' : 'restore-manual-secret-input';
        assert.deepEqual(page.actions, [
            ...(shot.page === 'sign-in' && shot.width === 390 ? [
                ['wait', 'brand-hero-get-started', 'visible'], ['click', 'brand-hero-get-started'],
            ] : []),
            ['wait', form, 'visible'],
        ], shot.name);
    }
});

test('readiness fails clearly when Relay not supported appears instead of a form', async () => {
    for (const shot of [
        { page: 'sign-in', readyTestId: 'welcome-secondary-login' },
        { page: 'restore', readyTestId: 'restore-manual-secret-input' },
        { page: 'desk', width: 390 },
    ]) {
        const unsupported = readinessPage({ relayVisible: true });
        await assert.rejects(waitForAppReady(unsupported, shot), /Relay not supported/);
    }
    const pendingForm = readinessPage({ relayVisible: true, readyError: new Error('selector timed out') });
    await assert.rejects(waitForAppReady(pendingForm, { page: 'sign-in', readyTestId: 'welcome-secondary-login' }), /Relay not supported/);
});

test('a relay error fails the row while restore or any phone sign-in step is pending', async () => {
    for (const [row, pendingAction] of [
        [{ page: 'restore', readyTestId: 'restore-manual-secret-input' }, 'wait:restore-manual-secret-input'],
        [{ page: 'sign-in', width: 390, readyTestId: 'welcome-secondary-login' }, 'wait:brand-hero-get-started'],
        [{ page: 'sign-in', width: 390, readyTestId: 'welcome-secondary-login' }, 'click:brand-hero-get-started'],
        [{ page: 'sign-in', width: 390, readyTestId: 'welcome-secondary-login' }, 'wait:welcome-secondary-login'],
    ]) {
        const shot = { ...row, appPath: '/', appImage: 'app/pending.png' };
        let showRelayError;
        // The browser can show the error even if production never installs its watcher.
        const relayShown = new Promise(resolve => { showRelayError = resolve; });
        let visible = false;
        let reachPending;
        const pending = new Promise(resolve => { reachPending = resolve; });
        let releasePending;
        const pendingFinished = new Promise(resolve => { releasePending = resolve; });
        const action = key => {
            if (key !== pendingAction) return Promise.resolve();
            reachPending();
            return pendingFinished;
        };
        const screenshots = [];
        const page = {
            goto: async () => {},
            screenshot: async options => { screenshots.push(options.path); },
            getByTestId: id => ({ waitFor: () => action(`wait:${id}`), click: () => action(`click:${id}`) }),
            getByText: () => ({ first() { return this; },
                waitFor: () => relayShown,
                isVisible: async () => visible,
            }),
        };
        const captured = captureShot(page, shot, 'app', 'http://127.0.0.1:1', '/shots')
            .then(() => ({ success: true }), error => ({ error }));
        try {
            await Promise.race([pending, captured.then(() => assert.fail(`Capture completed before ${pendingAction}`))]);
            visible = true;
            showRelayError();
            const result = await Promise.race([
                captured,
                new Promise(resolve => setImmediate(() => resolve({ pending: true }))),
            ]);
            assert.equal(result.pending, undefined, `Relay must fail the row while ${pendingAction} is still pending`);
            assert.match(result.error?.message ?? '', /Relay not supported/, pendingAction);
            assert.match(shot.appError ?? '', /Relay not supported/);
            assert.equal(shot.appFailureImage, 'app/pending-FAIL.png');
            assert.deepEqual(screenshots, [join('/shots', shot.appFailureImage)]);
        } finally {
            releasePending();
            await captured;
        }
    }
});

const BOUNDARY_TEST_IDS = new Set(['router_error_message', 'app-crash-restart']);

// Playwright boundary: locator state and browser globals change as the clock/fonts settle.
// The runner's navigation, readiness, evaluation callbacks and capture/error handling remain real.
function capturePage(shot, { onClock = () => {}, onFonts = () => {}, boundaryVisible = false, boundaryTestId = 'router_error_message' } = {}) {
    const state = { boundaryVisible, boundaryTestId, relayVisible: false, absent: new Set(), hidden: new Set() };
    const screenshots = [];
    const locator = id => ({
        first() { return this; },
        isVisible: async () => BOUNDARY_TEST_IDS.has(id) ? state.boundaryVisible && id === state.boundaryTestId
            : id === 'Relay not supported' ? state.relayVisible : !state.absent.has(id) && !state.hidden.has(id),
        count: async () => state.absent.has(id) ? 0 : 1,
        click: async () => {},
        waitFor: async ({ state: required }) => {
            if (id === 'Relay not supported') {
                if (state.relayVisible) return;
                return new Promise(() => {});
            }
            if (state.absent.has(id) || (required === 'visible' && state.hidden.has(id))) {
                throw new Error(`Element ${id} is not ${required}`);
            }
        },
    });
    const document = {
        fonts: { get ready() { onFonts(state); return Promise.resolve(); } },
        documentElement: { scrollWidth: shot.width },
        body: { get innerText() { return state.relayVisible ? 'Relay not supported' : ''; } },
        querySelectorAll: () => [],
    };
    return {
        state, screenshots,
        goto: async () => {},
        getByTestId: locator, getByText: locator,
        clock: { runFor: async () => { onClock(state); } },
        evaluate: async fn => runInNewContext(`(${fn})()`, { document, location: { pathname: shot.appPath }, innerWidth: shot.width }),
        screenshot: async options => { screenshots.push(options.path); },
    };
}

async function assertFailedCapture(page, shot, expected) {
    await assert.rejects(captureShot(page, shot, 'app', 'http://127.0.0.1:1', '/shots'), expected);
    assert.match(shot.appError, expected);
    const failureImage = shot.appImage.replace(/\.png$/, '-FAIL.png');
    assert.equal(shot.appFailureImage, failureImage);
    assert.deepEqual(page.screenshots, [join('/shots', failureImage)]);
    if (shot.theme) {
        const html = renderSheetHtml([shot]);
        assert.ok(html.includes(`href="${failureImage}"`));
        assert.ok(!html.includes(`src="${shot.appImage}"`));
    }
}

const capturedRows = () => [...buildShotMatrix(), ...buildShotMatrix('sheet').filter(shot => !shot.appGap)];

test('an error appearing after readiness during clock or font settling fails capture with a diagnostic image', async () => {
    for (const row of capturedRows()) for (const phase of ['onClock', 'onFonts']) {
        const shot = { ...row };
        const page = capturePage(shot, { [phase]: state => {
            state.boundaryVisible = true;
            state.absent = new Set(['ip-work', 'ABC-12', 'ip-fixture-coordinator-body', shot.readyTestId]);
        } });
        await assertFailedCapture(page, shot, /error boundary/i);
    }
});

test('an error boundary beside surviving ready elements still fails capture', async () => {
    for (const shot of capturedRows()) {
        await assertFailedCapture(capturePage(shot, { boundaryVisible: true }), shot, /error boundary/i);
    }
});

test("Happier's crash recovery screen fails capture, before or after settling", async () => {
    for (const shot of capturedRows()) {
        const shown = { ...shot };
        await assertFailedCapture(
            capturePage(shown, { boundaryVisible: true, boundaryTestId: 'app-crash-restart' }),
            shown, /error boundary/i);
        const settled = { ...shot };
        const page = capturePage(settled, { boundaryTestId: 'app-crash-restart', onFonts: state => {
            state.boundaryVisible = true;
        } });
        await assertFailedCapture(page, settled, /error boundary/i);
    }
});

test('a relay error appearing after readiness fails capture with the relay message', async () => {
    for (const shot of capturedRows()) {
        const page = capturePage(shot, { onFonts: state => { state.relayVisible = true; } });
        await assertFailedCapture(page, shot, /Relay not supported/);
    }
});

test('capture rechecks every ready element after fonts, retaining the phone attached rule', async () => {
    for (const row of capturedRows()) {
        const ids = row.page === 'desk' ? ['ip-work', 'ABC-12', 'ip-fixture-coordinator-body'] : [row.readyTestId];
        for (const id of ids) for (const change of ['absent', 'hidden']) {
            const shot = { ...row };
            const page = capturePage(shot, { onFonts: state => { state[change].add(id); } });
            if (change === 'hidden' && shot.width === 390 && ['ip-work', 'ABC-12'].includes(id)) {
                await captureShot(page, shot, 'app', 'http://127.0.0.1:1', '/shots');
                assert.equal(shot.appError, undefined);
                assert.deepEqual(page.screenshots, [join('/shots', shot.appImage)]);
            } else {
                await assertFailedCapture(page, shot, /ready element/i);
            }
        }
    }
});

test('healthy ready rows still capture successfully in both modes', async () => {
    for (const shot of capturedRows()) {
        const page = capturePage(shot);
        await captureShot(page, shot, 'app', 'http://127.0.0.1:1', '/shots');
        assert.equal(shot.appError, undefined);
        assert.equal(shot.appFailureImage, undefined);
        assert.deepEqual(page.screenshots, [join('/shots', shot.appImage)]);
    }
});

test('an unavailable failure screenshot preserves the original failure and never links a missing image', async () => {
    const [shot] = buildShotMatrix('sheet');
    const original = new Error('navigation failed');
    const page = {
        goto: async () => { throw original; },
        screenshot: async () => { throw new Error('page closed'); },
    };
    await assert.rejects(captureShot(page, shot, 'app', 'http://127.0.0.1:1', '/shots'), error => error === original);
    assert.match(shot.appError ?? '', /navigation failed.*failure screenshot.*page closed/i);
    assert.equal(shot.appFailureImage, undefined);
    assert.doesNotMatch(renderSheetHtml([shot]), /href="app\/[^"\s]*-FAIL\.png"/);
});

test('failed captures save a diagnostic image beside the intended image and link it from the sheet', async () => {
    for (const side of ['app', 'mockup']) {
        const [shot] = buildShotMatrix('sheet');
        const renderedError = new Error('navigation failed');
        const screenshots = [];
        const page = {
            goto: async () => { throw renderedError; },
            screenshot: async options => { screenshots.push(options.path); },
        };
        await assert.rejects(captureShot(page, shot, side, 'http://127.0.0.1:1', '/shots'), error => error === renderedError);
        const failureImage = shot[`${side}Image`].replace(/\.png$/, '-FAIL.png');
        assert.deepEqual(screenshots, [join('/shots', failureImage)]);
        assert.equal(shot[`${side}Error`], renderedError.message);
        assert.equal(shot[`${side}FailureImage`], failureImage);
        assert.ok(renderSheetHtml([shot]).includes(`href="${failureImage}"`));
    }
});

test('phone readiness accepts the mounted hidden Work tab while requiring the visible coordinator', async () => {
    const page = readinessPage();
    const { waits } = page;
    await waitForAppReady(page, { page: 'desk', width: 390 });
    assert.deepEqual(waits, [
        ['ip-work', 'attached'], ['ABC-12', 'attached'], ['ip-fixture-coordinator-body', 'visible'],
    ]);
    waits.length = 0;
    await waitForAppReady(page, { page: 'desk', width: 1440 });
    assert.deepEqual(waits.map(([, state]) => state), ['visible', 'visible', 'visible']);
});

test('local pages and sockets are allowed', () => {
    for (const url of ['http://127.0.0.1:38993/_expo/static/js/web/x.js', 'http://localhost:1/', 'ws://127.0.0.1:5/socket.io/', 'http://[::1]:8080/a']) {
        assert.equal(isForbiddenRequestUrl(url), false, url);
    }
});

test('every other http, https, ws or wss host is forbidden, including look-alikes', () => {
    for (const url of [
        'https://api.happier.dev/v1/features',
        'https://eu-assets.i.posthog.com/array/k/config',
        'wss://box.tailnet-name.ts.net/socket.io/',
        'http://127.0.0.1.evil.example/',
        'http://localhost.evil.example/',
        'http://192.168.1.5:3005/',
        'ws://example.com/',
    ]) {
        assert.equal(isForbiddenRequestUrl(url), true, url);
    }
});

test('data, blob and about URLs are not network requests', () => {
    for (const url of ['data:image/png;base64,AAAA', 'blob:http://127.0.0.1:1/abc', 'about:blank']) {
        assert.equal(isForbiddenRequestUrl(url), false, url);
    }
});

test('an unparseable URL is forbidden rather than waved through', () => {
    assert.equal(isForbiddenRequestUrl('not a url'), true);
});

function fakeContext() {
    const handlers = {};
    return {
        handlers,
        route: async (_pattern, handler) => { handlers.route = handler; },
        routeWebSocket: async (_pattern, handler) => { handlers.webSocket = handler; },
    };
}

test('the network guard aborts a request to another host and lets a local one through', async () => {
    const context = fakeContext();
    const blocked = [];
    await installNetworkGuard(context, blocked);
    const outcomes = [];
    const routeFor = (url) => ({
        request: () => ({ url: () => url, method: () => 'GET' }),
        abort: (reason) => outcomes.push(`abort ${reason}`),
        continue: () => outcomes.push('continue'),
    });
    await context.handlers.route(routeFor('https://api.happier.dev/v1/features'));
    await context.handlers.route(routeFor('http://127.0.0.1:5/index.js'));
    assert.deepEqual(outcomes, ['abort blockedbyclient', 'continue']);
    assert.deepEqual(blocked, ['GET https://api.happier.dev']);
});

test('the network guard closes a WebSocket to another host without ever opening it, and connects a local one', async () => {
    const context = fakeContext();
    const blocked = [];
    await installNetworkGuard(context, blocked);
    const calls = [];
    const socketFor = (url) => ({ url: () => url, close: () => calls.push('close'), connectToServer: () => calls.push('connect') });
    context.handlers.webSocket(socketFor('wss://box.tailnet-name.ts.net/socket.io/'));
    context.handlers.webSocket(socketFor('ws://127.0.0.1:9/socket.io/'));
    assert.deepEqual(calls, ['close', 'connect']);
    assert.deepEqual(blocked, ['WS wss://box.tailnet-name.ts.net/socket.io/']);
});

test('decodeRequestPath returns null for a malformed escape instead of throwing', () => {
    assert.equal(decodeRequestPath('/a%20b.js'), '/a b.js');
    assert.equal(decodeRequestPath('/%E0%A4%A'), null);
});
