import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { parseArgs, postProcessExport, demoEnvironment, resolveWatchFolders } from './buildDeskDemo.mjs';

test('arguments default to a contained export and normalize an absolute base path', () => {
    assert.deepEqual(parseArgs([], '/repo'), { outdir: '/repo/.project/tmp/desk-demo', basePath: '/desk-demo/' });
    assert.deepEqual(parseArgs(['out', '/preview/desk'], '/repo'), { outdir: '/repo/out', basePath: '/preview/desk/' });
    for (const base of ['https://example.com', '//host', '/a/../b', '/a?x', '/a#x', '/a%2fb', '/a\\b', '/a//b']) {
        assert.throws(() => parseArgs(['out', base], '/repo'), /base/i);
    }
    assert.throws(() => parseArgs(['out', '/demo', 'extra'], '/repo'), /usage/i);
    for (const output of ['/', '/repo', '/repo/apps', '/repo/apps/ui', '/repo/apps/ui/sources']) {
        assert.throws(() => parseArgs([output], '/repo'), /output/i);
    }
});

test('watch folders include package-link install roots as well as local module directories', () => {
    const dir = mkdtempSync(join(tmpdir(), 'demo-linked-install-'));
    try {
        const checkout = join(dir, 'checkout');
        const install = join(dir, 'install');
        for (const root of [checkout, install]) {
            mkdirSync(join(root, 'node_modules'), { recursive: true });
            mkdirSync(join(root, 'apps/ui/node_modules'), { recursive: true });
        }
        mkdirSync(join(install, 'node_modules/expo-constants'));
        mkdirSync(join(install, 'apps/ui/node_modules/expo'));
        symlinkSync(join(install, 'node_modules/expo-constants'), join(checkout, 'node_modules/expo-constants'), 'junction');
        symlinkSync(join(install, 'apps/ui/node_modules/expo'), join(checkout, 'apps/ui/node_modules/expo'), 'junction');
        const folders = resolveWatchFolders(checkout);
        assert.ok(folders.includes(join(install, 'node_modules')), 'hoisted linked modules are watched');
        assert.ok(folders.includes(join(install, 'apps/ui/node_modules')), 'app-local linked modules are watched');
        assert.ok(folders.includes(join(checkout, 'node_modules')));
        assert.ok(folders.includes(join(checkout, 'apps/ui/node_modules')));
        assert.equal(new Set(folders).size, folders.length);
    } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('export environment excludes inherited endpoints and keys and disables dotenv/analytics', () => {
    const env = demoEnvironment({ PATH: '/bin', EXPO_PUBLIC_HAPPIER_SERVER_URL: 'https://private.invalid', EXPO_PUBLIC_SENTRY_DSN: 'secret', HAPPIER_TOKEN: 'secret', EXPO_PUBLIC_POSTHOG_KEY: 'secret' }, '/desk-demo/', '/tmp/cache', []);
    assert.equal(env.EXPO_PUBLIC_HAPPIER_SERVER_URL, '');
    assert.equal(env.EXPO_PUBLIC_HAPPY_SERVER_URL, '');
    assert.equal(env.EXPO_PUBLIC_SERVER_URL, '');
    assert.equal(env.EXPO_PUBLIC_SENTRY_DSN, undefined);
    assert.equal(env.HAPPIER_TOKEN, undefined);
    assert.equal(env.EXPO_PUBLIC_POSTHOG_KEY, undefined);
    assert.equal(env.EXPO_NO_DOTENV, '1');
    assert.equal(env.EXPO_PUBLIC_IP_FIXTURES, '1');
    assert.equal(env.EXPO_PUBLIC_HAPPIER_BUILD_FEATURES_DENY, 'app.analytics');
    assert.equal(env.EXPO_BASE_URL, '/desk-demo');
    assert.equal(env.EXPO_APP_LOCAL_CONFIG_PATH, '/tmp/cache/app.local.cjs');
});

test('post-processing supplies root entry and a reloadable directory index before Expo starts', () => {
    const dir = mkdtempSync(join(tmpdir(), 'demo-export-'));
    try {
        mkdirSync(join(dir, '_expo/static/js/web'), { recursive: true });
        writeFileSync(join(dir, 'index.html'), '<html><head><title>Happier</title><link rel="manifest" href="/manifest.webmanifest"><link rel="apple-touch-icon" href="/icons/icon.png"></head><body><script src="/nested/demo/_expo/static/js/web/entry.js" defer></script></body></html>');
        writeFileSync(join(dir, '_expo/static/js/web/entry.js'), 'const font="/ignore-previous/fonts/font.woff2";const icon="/favicon-active.ico";');
        postProcessExport(dir, '/nested/demo/');
        const html = readFileSync(join(dir, 'index.html'), 'utf8');
        assert.ok(!html.includes('rel="manifest"'));
        assert.ok(html.includes('href="/nested/demo/icons/icon.png"'));
        assert.ok(readFileSync(join(dir, '_expo/static/js/web/entry.js'), 'utf8').includes('/nested/demo/favicon-active.ico'));
        assert.ok(html.indexOf('desk-demo-entry.js') < html.indexOf('_expo/static'));
        assert.equal(readFileSync(join(dir, 'dev/desk-fixture/index.html'), 'utf8'), html);
        assert.match(readFileSync(join(dir, '_expo/static/js/web/entry.js'), 'utf8'), /\/nested\/demo\/ignore-previous\/fonts/);
        const bootstrap = readFileSync(join(dir, 'desk-demo-entry.js'), 'utf8');
        for (const path of ['/nested/demo/', '/nested/demo/dev/desk-fixture/']) {
            const calls = [];
            vm.runInNewContext(bootstrap, { location: { pathname: path, search: '' }, history: { replaceState: (...args) => calls.push(args) } });
            assert.equal(calls[0][2], '/nested/demo/dev/desk-fixture/?data=demo');
        }
        postProcessExport(dir, '/nested/demo/');
        assert.equal(readFileSync(join(dir, 'index.html'), 'utf8'), html);
    } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('Expo config remains unchanged by default; baseUrl is opt-in only', () => {
    const filename = resolve('apps/ui/app.config.js');
    const source = readFileSync(filename, 'utf8').replace('export default', 'module.exports =');
    const require = createRequire(filename);
    function config(base) {
        const env = { ...process.env };
        delete env.EXPO_BASE_URL;
        if (base !== undefined) env.EXPO_BASE_URL = base;
        const context = { module: { exports: {} }, require, process: { ...process, env }, __dirname: resolve('apps/ui'), console };
        vm.runInNewContext(source, context, { filename });
        return JSON.parse(JSON.stringify(context.module.exports.expo));
    }
    const original = config();
    assert.deepEqual(original.experiments, { typedRoutes: true });
    assert.deepEqual(config(''), original);
    const demo = config('/desk-demo');
    assert.equal(demo.experiments.baseUrl, '/desk-demo');
    delete demo.experiments.baseUrl;
    assert.deepEqual(demo, original);
});
