import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { closeSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXTRA_SENTINELS, readFixtureMarker, scanForNeedles } from './ipFixtureShipGuard.mjs';

const GUARD = join(dirname(fileURLToPath(import.meta.url)), 'ipFixtureShipGuard.mjs');
const ENTRY = '_expo/static/js/web/index-0123abcd.js';
const PAGE = `<html><script src="/${ENTRY}" defer></script></html>`;

function exportDir(files) {
    const dir = mkdtempSync(join(tmpdir(), 'ip-ship-guard-'));
    for (const [name, text] of Object.entries(files)) {
        const file = join(dir, name);
        mkdirSync(join(file, '..'), { recursive: true });
        writeFileSync(file, text);
    }
    return dir;
}

function cleanExport(extra = {}) {
    return exportDir({ 'index.html': PAGE, [ENTRY]: 'console.log("desk")', ...extra });
}

function runGuard(...args) {
    // File-backed stdio also works where the sandbox rejects Node's child pipe setup (EPERM).
    const dir = mkdtempSync(join(tmpdir(), 'ip-guard-output-'));
    const output = join(dir, 'output');
    const fd = openSync(output, 'w');
    try {
        const result = spawnSync(process.execPath, [GUARD, ...args], { stdio: ['ignore', fd, fd] });
        assert.ifError(result.error);
        assert.equal(result.signal, null);
        return { code: result.status, out: readFileSync(output, 'utf8') };
    } finally {
        closeSync(fd);
        rmSync(dir, { recursive: true, force: true });
    }
}

test('readFixtureMarker reads the marker from the fixture scenario, not from a copy here', () => {
    assert.match(readFixtureMarker(), /^ip-fixture-marker-[0-9a-f]+$/);
});

test('scanForNeedles passes a clean export and says how much it looked at', () => {
    const dir = cleanExport({ '_expo/static/js/web/other.js': 'x' });
    const result = scanForNeedles(dir, ['ip-fixture-marker-7f3a']);
    assert.deepEqual(result.hits.get('ip-fixture-marker-7f3a'), []);
    assert.equal(result.scanned, 3);
});

test('scanForNeedles lists every file that carries a needle, nested ones included', () => {
    const dir = cleanExport({
        [ENTRY]: 'var a="ip-fixture-marker-7f3a"',
        '_expo/static/js/web/chunk.js': 'clean',
        'assets/deep/er/data.json': '{"marker":"ip-fixture-marker-7f3a"}',
    });
    const hits = scanForNeedles(dir, ['ip-fixture-marker-7f3a']).hits.get('ip-fixture-marker-7f3a');
    assert.deepEqual(hits.map((f) => f.slice(dir.length + 1)).sort(), [ENTRY, 'assets/deep/er/data.json']);
});

test('the guard exits 0 on a clean export', () => {
    const { code, out } = runGuard(cleanExport());
    assert.equal(code, 0, out);
    assert.match(out, /PASS/);
});

test('the guard exits 1 when the marker is in the output', () => {
    const { code, out } = runGuard(cleanExport({ [ENTRY]: `x="${readFixtureMarker()}"` }));
    assert.equal(code, 1, out);
    assert.match(out, /FAIL/);
});

for (const sentinel of EXTRA_SENTINELS) {
    test(`the guard exits 1 on the stale-cache leftover ${JSON.stringify(sentinel)}, with no marker present`, () => {
        const { code, out } = runGuard(cleanExport({ [ENTRY]: `x=${JSON.stringify(sentinel)}` }));
        assert.equal(code, 1, out);
        assert.ok(out.includes(JSON.stringify(sentinel)), out);
    });
}

test('the guard exits 2 with no argument, for a missing folder, and for a folder that is not a finished web export', () => {
    assert.equal(runGuard().code, 2);
    assert.equal(runGuard(join(tmpdir(), 'ip-ship-guard-does-not-exist')).code, 2);
    // No JavaScript at all, no index.html, an index.html that names no script, or one whose script is missing:
    // each is a partial export or the wrong folder.
    assert.equal(runGuard(exportDir({ 'index.html': '<html></html>' })).code, 2);
    assert.equal(runGuard(exportDir({ [ENTRY]: 'x' })).code, 2);
    assert.equal(runGuard(exportDir({ 'index.html': '<html></html>', [ENTRY]: 'x' })).code, 2);
    assert.equal(runGuard(exportDir({ 'index.html': PAGE, '_expo/static/js/web/other.js': 'x' })).code, 2);
    // An empty entry bundle is still a bundle the guard cannot be fooled by, so only a missing one is refused.
    assert.equal(runGuard(exportDir({ 'index.html': PAGE, [ENTRY]: '' })).code, 0);
});

const SECOND = '_expo/static/js/web/another-bundle.js';
// A real `expo export -p web` page loads Metro's runtime and the shared chunk before the entry.
const RUNTIME = '_expo/static/js/web/__expo-metro-runtime-42ac0f1b.js';
const COMMON = '_expo/static/js/web/__common-f82d2224.js';
const REAL_PAGE = `<html><script src="/${RUNTIME}" defer></script><script src="/${COMMON}" defer></script><script src="/${ENTRY}" defer></script></html>`;
for (const [name, files, expected] of [
    ['empty directory', {}, 2],
    ['renamed entry absent from HTML', { 'index.html': PAGE, [SECOND]: 'clean' }, 2],
    ['missing second entry', { 'index.html': PAGE + `<script src="/${SECOND}"></script>`, [ENTRY]: 'clean' }, 2],
    ['two existing entries', { 'index.html': PAGE + `<script src="/${SECOND}"></script>`, [ENTRY]: 'clean', [SECOND]: 'clean' }, 2],
    ['comment-only reference', { 'index.html': `<!-- ${PAGE} -->`, [ENTRY]: 'clean' }, 2],
    ['inert template reference', { 'index.html': `<template>${PAGE}</template>`, [ENTRY]: 'clean' }, 2],
    ['base changes script location', { 'index.html': '<base href="/nested/">' + PAGE.replace(`/${ENTRY}`, ENTRY), [ENTRY]: 'clean' }, 2],
    ['plain text reference', { 'index.html': ENTRY, [ENTRY]: 'clean' }, 2],
    ['attribute-only reference', { 'index.html': `<div data-html='${PAGE}'></div>`, [ENTRY]: 'clean' }, 2],
    ['inline script text reference', { 'index.html': `<script>const name="${ENTRY}"</script>`, [ENTRY]: 'clean' }, 2],
    ['missing local supporting script', { 'index.html': PAGE + '<script src="/support.js"></script>', [ENTRY]: 'clean' }, 2],
    ['existing local supporting script', { 'index.html': PAGE + '<script src="/support.js"></script>', [ENTRY]: 'clean', 'support.js': 'clean' }, 0],
    ['arbitrary entry filename', { 'index.html': `<script defer src='/${SECOND}'></script>`, [SECOND]: 'clean' }, 0],
    ['comment ignored beside real entry', { 'index.html': PAGE + `<!-- <script src="/${SECOND}"></script> -->`, [ENTRY]: 'clean' }, 0],
    ['real export shape: runtime and common beside the entry', { 'index.html': REAL_PAGE, [RUNTIME]: 'clean', [COMMON]: 'clean', [ENTRY]: 'clean' }, 0],
    ['real export shape with a marked common chunk', { 'index.html': REAL_PAGE, [RUNTIME]: 'clean', [COMMON]: readFixtureMarker(), [ENTRY]: 'clean' }, 1],
    ['only Expo support bundles, no entry', { 'index.html': `<script src="/${RUNTIME}"></script><script src="/${COMMON}"></script>`, [RUNTIME]: 'clean', [COMMON]: 'clean' }, 2],
    ['real export shape with a missing common chunk', { 'index.html': REAL_PAGE, [RUNTIME]: 'clean', [ENTRY]: 'clean' }, 2],
    ['unreferenced marked split chunk', { 'index.html': PAGE, [ENTRY]: 'clean', 'chunks/split.js': readFixtureMarker() }, 1],
]) {
    test(`the guard validates export shape: ${name}`, () => {
        const { code, out } = runGuard(exportDir(files));
        assert.equal(code, expected, out);
        assert.match(out, expected === 2 ? /cannot judge/ : expected === 1 ? /FAIL/ : /PASS/);
    });
}
