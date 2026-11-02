import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXTRA_SENTINELS, readFixtureMarker, scanForNeedles } from './ipFixtureShipGuard.mjs';

const GUARD = join(dirname(fileURLToPath(import.meta.url)), 'ipFixtureShipGuard.mjs');
const ENTRY = '_expo/static/js/web/entry-abc.js';

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
    return exportDir({ 'index.html': '<html></html>', [ENTRY]: 'console.log("desk")', ...extra });
}

function runGuard(...args) {
    const result = spawnSync(process.execPath, [GUARD, ...args], { encoding: 'utf8' });
    return { code: result.status, out: result.stdout + result.stderr };
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
    // No JavaScript at all, no index.html, no entry bundle: each is a partial export or the wrong folder.
    assert.equal(runGuard(exportDir({ 'index.html': '<html></html>' })).code, 2);
    assert.equal(runGuard(exportDir({ [ENTRY]: 'x' })).code, 2);
    assert.equal(runGuard(exportDir({ 'index.html': 'x', '_expo/static/js/web/other.js': 'x' })).code, 2);
    // An empty entry bundle is still a bundle the guard cannot be fooled by, so only a missing one is refused.
    assert.equal(runGuard(exportDir({ 'index.html': 'x', [ENTRY]: '' })).code, 0);
});
