import { expect } from '@playwright/test';

import { deskGuardTest as test } from '../../src/testkit/deskTest/deskTest';

/**
 * Proves the request guard fails a test. Each probe is expected to fail through the guard's teardown,
 * so the run goes red if the guard ever lets one through. Set DESK_GUARD_SHOW_FAILURE=1 to see the
 * failures themselves. The hosts can't resolve or route, so even a broken guard reaches nothing real
 * (originGuard.test.mjs covers 127.0.0.1:3005 and api.happier.dev without any traffic).
 */
const PROBES = [
    ['a non-local host', 'https://desk-guard-probe.invalid/'],
    ['hosted Happier', 'https://desk-guard-probe.invalid.happier.dev/'],
    ['a tailnet host', 'https://desk-guard-probe.invalid.ts.net/'],
    ['port 3005', 'http://192.0.2.1:3005/desk-guard-probe'],
] as const;

for (const [name, url] of PROBES) {
    test(`a request to ${name} fails the test`, async ({ page }) => {
        test.fail(process.env.DESK_GUARD_SHOW_FAILURE !== '1', 'the guard must fail this test');
        await page.evaluate((target) => fetch(target, { mode: 'no-cors' }).catch(() => null), url);
    });
}

test('a websocket to a non-local host fails the test', async ({ page }) => {
    test.fail(process.env.DESK_GUARD_SHOW_FAILURE !== '1', 'the guard must fail this test');
    await page.evaluate(
        (target) => new Promise((done) => {
            const socket = new WebSocket(target);
            socket.onopen = socket.onclose = socket.onerror = () => done(null);
        }),
        'wss://desk-guard-probe.invalid/socket',
    );
});

test('a page that asks for nothing forbidden passes', async ({ page, blockedRequests }) => {
    await page.evaluate(() => 1 + 1);
    expect(blockedRequests).toEqual([]);
});
