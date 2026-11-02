import { createServer, type Server } from 'node:http';
import { expect } from '@playwright/test';

import { deskGuardTest } from '../../src/testkit/deskTest/deskTest';

type Probe = { origin: string; hits: () => number };
type Probes = { plain: Probe; target: Probe; redirect: Probe };

/** All destinations are disposable loopback servers, even if the guard breaks completely. */
const test = deskGuardTest.extend<{ probes: Probes }>({
    probes: async ({}, use) => {
        const servers: Server[] = [];
        const start = async (location?: (path: string, hits: number) => string | null): Promise<Probe> => {
            let hits = 0;
            const server = createServer((req, res) => {
                hits++;
                const destination = location?.(req.url ?? '/', hits) ?? null;
                res.writeHead(destination !== null ? 302 : 200, destination !== null ? { location: destination } : { 'content-type': 'text/plain' });
                res.end(destination !== null ? '' : 'local probe');
            });
            servers.push(server);
            server.on('upgrade', (_req, socket) => { hits++; socket.destroy(); });
            await new Promise<void>((resolve, reject) => {
                server.once('error', reject);
                server.listen(0, '127.0.0.1', resolve);
            });
            const address = server.address();
            if (!address || typeof address === 'string') throw new Error('No probe port');
            return { origin: `http://127.0.0.1:${address.port}`, hits: () => hits };
        };
        try {
            const plain = await start();
            const target = await start();
            const redirect = await start((path, hits) => path === '/empty' && hits === 1 ? '' : path === '/chain' ? '/next' : path === '/ok' ? null : `${target.origin}/target`);
            await use({ plain, target, redirect });
        } finally {
            for (const server of servers.reverse()) {
                server.closeAllConnections();
                await new Promise<void>((resolve) => server.close(() => resolve()));
            }
        }
    },
    // Allow-listing the probes too proves forbidden rules override explicit permission.
    deskAllowedOrigins: async ({ probes }, use) => {
        await use([probes.plain.origin, probes.target.origin, probes.redirect.origin]);
    },
    deskExtraForbiddenOrigins: async ({ probes }, use) => {
        await use([probes.plain.origin, probes.target.origin]);
    },
});

test('a direct HTTP refusal records the exact URL without contacting the local server', async ({ page, probes, blockedRequests }) => {
    const url = `${probes.plain.origin}/probe`;
    await page.evaluate((target) => fetch(target, { mode: 'no-cors' }).catch(() => null), url);
    expect(blockedRequests).toEqual([{ url, reason: 'a test-only forbidden origin' }]);
    expect(probes.plain.hits()).toBe(0);
    blockedRequests.splice(0); // Consume only after proving the specific refusal; teardown owns unexpected entries.
});

test('a websocket refusal records the exact URL without contacting the local server', async ({ page, probes, blockedRequests }) => {
    const url = `${probes.plain.origin.replace('http:', 'ws:')}/socket`;
    const outcome = await page.evaluate((target) => new Promise<string>((done) => {
        const socket = new WebSocket(target);
        socket.onopen = () => { socket.close(); done('opened'); };
        socket.onclose = socket.onerror = () => done('closed');
    }), url);
    expect(outcome).toBe('closed');
    expect(blockedRequests).toEqual([{ url, reason: 'a test-only forbidden origin' }]);
    expect(probes.plain.hits()).toBe(0);
    blockedRequests.splice(0);
});

for (const path of ['/redirect', '/chain', '/empty']) {
    test(`a forbidden redirect after ${path} never reaches its local destination`, async ({ page, probes, blockedRequests }) => {
        await page.evaluate((url) => fetch(url, { mode: 'no-cors' }).catch(() => null), `${probes.redirect.origin}${path}`);
        expect(probes.redirect.hits()).toBe(path === '/chain' || path === '/empty' ? 2 : 1);
        expect(blockedRequests).toEqual([{ url: `${probes.target.origin}/target`, reason: 'a test-only forbidden origin' }]);
        expect(probes.target.hits()).toBe(0);
        expect(probes.plain.hits()).toBe(0);
        blockedRequests.splice(0);
    });
}

test('an allowed response reaches the browser without a refusal', async ({ page, probes, blockedRequests }) => {
    await page.goto(`${probes.redirect.origin}/ok`);
    await expect(page.locator('body')).toHaveText('local probe');
    expect(blockedRequests).toEqual([]);
});
