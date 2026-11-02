import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isForbiddenRequestUrl } from './ipFixtureShots.mjs';

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
