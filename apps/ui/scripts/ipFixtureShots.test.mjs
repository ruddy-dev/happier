import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeRequestPath, installNetworkGuard, isForbiddenRequestUrl } from './ipFixtureShots.mjs';
import { buildShotMatrix, buildStorageSeed, renderSheetHtml, THEME_MAP, waitForAppReady } from './ipFixtureShots.mjs';

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
            assert.match(shot.mockupGap, /no sign-in/i);
        }
        if (shot.page === 'restore') {
            assert.equal(shot.appPath, '/restore/manual');
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
});

test('phone readiness accepts the mounted hidden Work tab while requiring the visible coordinator', async () => {
    const waits = [];
    const locator = id => ({
        first() { return this; },
        waitFor: async options => { waits.push([id, options.state ?? 'visible']); },
    });
    const page = { getByTestId: locator, getByText: locator };
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
