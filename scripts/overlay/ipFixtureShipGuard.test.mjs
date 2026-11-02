import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFixtureMarker, scanForMarker } from './ipFixtureShipGuard.mjs';

function exportDir(files) {
    const dir = mkdtempSync(join(tmpdir(), 'ip-ship-guard-'));
    for (const [name, text] of Object.entries(files)) {
        const file = join(dir, name);
        mkdirSync(join(file, '..'), { recursive: true });
        writeFileSync(file, text);
    }
    return dir;
}

test('readFixtureMarker reads the marker from the fixture scenario, not from a copy here', () => {
    assert.match(readFixtureMarker(), /^ip-fixture-marker-[0-9a-f]+$/);
});

test('scanForMarker passes a clean export and says how much it looked at', () => {
    const dir = exportDir({
        'index.html': '<html></html>',
        '_expo/static/js/web/entry-abc.js': 'console.log("desk")',
        '_expo/static/js/web/other.js': 'x',
    });
    const result = scanForMarker(dir, 'ip-fixture-marker-7f3a');
    assert.deepEqual(result.hits, []);
    assert.equal(result.scanned, 3);
});

test('scanForMarker lists every file that carries the marker, nested ones included', () => {
    const dir = exportDir({
        'index.html': '<html></html>',
        '_expo/static/js/web/entry-abc.js': 'var a="ip-fixture-marker-7f3a"',
        '_expo/static/js/web/chunk.js': 'clean',
        'assets/deep/er/data.json': '{"marker":"ip-fixture-marker-7f3a"}',
    });
    const result = scanForMarker(dir, 'ip-fixture-marker-7f3a');
    assert.deepEqual(result.hits.map((f) => f.slice(dir.length + 1)).sort(), [
        '_expo/static/js/web/entry-abc.js',
        'assets/deep/er/data.json',
    ]);
});

test('scanForMarker throws on a folder that is missing or holds no JavaScript, so an empty export cannot pass', () => {
    assert.throws(() => scanForMarker(join(tmpdir(), 'ip-ship-guard-does-not-exist'), 'm'), /export/i);
    const dir = exportDir({ 'index.html': '<html></html>' });
    assert.throws(() => scanForMarker(dir, 'm'), /no JavaScript/i);
});
