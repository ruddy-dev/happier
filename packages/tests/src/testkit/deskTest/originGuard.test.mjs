// Run: node --test packages/tests/src/testkit/deskTest/originGuard.test.mjs (Node strips the .ts types).
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomInt } from 'node:crypto';

import { assertServerPort, DESK_ENV_KEEP, isAllowedOrigin, scrubEnv } from './originGuard.ts';

const port = randomInt(20_000, 60_000);
const allowed = [`http://127.0.0.1:${port}`];

test('GUARD-3005: the production server port on loopback is refused', () => {
  assert.equal(isAllowedOrigin('http://127.0.0.1:3005/v1/x', [...allowed, 'http://127.0.0.1:3005']), false);
  assert.equal(isAllowedOrigin('http://localhost:3005/', allowed), false);
});

test('GUARD-3005-any-host: port 3005 is refused on every host, not only loopback', () => {
  for (const url of ['http://[::1]:3005/', 'http://[::ffff:7f00:1]:3005/', 'http://192.168.1.5:3005/', 'http://desk-guard-probe.example:3005/']) {
    assert.equal(isAllowedOrigin(url, [...allowed, url]), false, url);
  }
});

test('GUARD-hosted: the hosted Happier API is refused', () => {
  assert.equal(isAllowedOrigin('https://api.happier.dev/', allowed), false);
});

test('GUARD-tailnet: a tailnet host is refused', () => {
  assert.equal(isAllowedOrigin('https://box.tail1234.ts.net/', allowed), false);
});

test('GUARD-local: the test server on its own port is allowed, over http and websocket', () => {
  assert.equal(isAllowedOrigin(`http://127.0.0.1:${port}/v1/sessions`, allowed), true);
  assert.equal(isAllowedOrigin(`ws://127.0.0.1:${port}/socket`, allowed), true);
});

test('GUARD-unlisted: any other origin is refused', () => {
  assert.equal(isAllowedOrigin('https://example.com/', allowed), false);
  assert.equal(isAllowedOrigin(`http://127.0.0.1:${port + 1}/`, allowed), false);
});

test('GUARD-env: the scrub removes app settings and keeps test switches and the rest', () => {
  const env = scrubEnv(
    {
      HAPPIER_SERVER_URL: 'x',
      HAPPY_SERVER_URL: 'z',
      EXPO_PUBLIC_API: 'y',
      HAPPIER_E2E_PROVIDER_USE_SERVER_SOURCE_ENTRYPOINT: '1',
      HAPPY_E2E_SAVE_ARTIFACTS: '1',
      PATH: '/bin',
    },
    DESK_ENV_KEEP,
  );
  assert.deepEqual(env, { HAPPIER_E2E_PROVIDER_USE_SERVER_SOURCE_ENTRYPOINT: '1', HAPPY_E2E_SAVE_ARTIFACTS: '1', PATH: '/bin' });
});

test('GUARD-port: a server on 3005 is refused before it starts', () => {
  assert.throws(() => assertServerPort(3005), /3005/);
  assert.doesNotThrow(() => assertServerPort(port));
});
