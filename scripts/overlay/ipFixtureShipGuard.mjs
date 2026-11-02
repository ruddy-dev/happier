#!/usr/bin/env node
// Ship guard for the desk fixture: a web export made WITHOUT EXPO_PUBLIC_IP_FIXTURES=1 must carry nothing of it.
// Usage: node scripts/overlay/ipFixtureShipGuard.mjs <export-dir>
// Exit 0: clean. Exit 1: a fixture string is in the output. Exit 2: bad usage, or the folder is not a usable web
// export (missing, no index.html, no _expo/static/js/web/entry-*.js), so an empty result would prove nothing.
//
// It looks for the fixture marker (which lives only in the fixture's JSON) and for four strings that the
// non-fixture files carry when the flag is on: the fixtures import path, the stub import path, the route's
// public-route check in authRouting, and the loader's error message. Metro's block list now keeps the fixtures
// folder out of any export made without the flag, so the marker alone is no longer enough: an export that
// reuses a Metro cache from a flag-on run loses the marker but keeps the other four, which means the public
// route and the stub import are still in the bundle.
//
// The export must be cold for the same reason. Metro's transform cache key leaves out EXPO_PUBLIC_* values, so
// build the guard's export with `expo export --clear`, or with a fresh TMPDIR (Metro keeps its cache there).
// A flag-on export must make this guard FAIL; run that once as the positive control, or the flag-off pass could
// be vacuous (for instance after the fixture stopped importing its JSON).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const FIXTURE_SCENARIO = join(
    dirname(fileURLToPath(import.meta.url)),
    '../../apps/ui/sources/ignorePrevious/fixtures/desk-fixture.json',
);

/** What a flag-on build carries outside the fixtures folder, as it appears in minified output. */
export const EXTRA_SENTINELS = [
    'ignorePrevious/fixtures',
    'fixtures/CoordinatorBodyStub',
    "'desk-fixture'===",
    'Desk fixture could not be loaded',
];

/** The marker lives only in the fixture scenario; the guard reads it from there. */
export function readFixtureMarker() {
    return JSON.parse(readFileSync(FIXTURE_SCENARIO, 'utf8')).marker;
}

function* walk(dir) {
    for (const name of readdirSync(dir)) {
        const file = join(dir, name);
        if (statSync(file).isDirectory()) yield* walk(file);
        else yield file;
    }
}

const ENTRY_BUNDLE = /^_expo\/static\/js\/web\/entry-.*\.js$/;

/**
 * Files under `dir` containing each needle, and how many files were read. Throws unless `dir` looks like a
 * finished web export (an index.html and an entry bundle), so a partial export or the wrong folder cannot pass.
 */
export function scanForNeedles(dir, needles) {
    let isDir = false;
    try {
        isDir = statSync(dir).isDirectory();
    } catch {
        // reported below
    }
    if (!isDir) throw new Error(`export folder not found: ${dir}`);
    const hits = new Map(needles.map((needle) => [needle, []]));
    let scanned = 0;
    let hasIndex = false;
    let hasEntry = false;
    for (const file of walk(dir)) {
        scanned += 1;
        const relative = file.slice(dir.length + 1).split(sep).join('/');
        if (relative === 'index.html') hasIndex = true;
        if (ENTRY_BUNDLE.test(relative)) hasEntry = true;
        const content = readFileSync(file);
        for (const needle of needles) if (content.includes(needle)) hits.get(needle).push(file);
    }
    if (!hasIndex) throw new Error(`no index.html under ${dir}: not a finished web export, so an empty result proves nothing`);
    if (!hasEntry) throw new Error(`no _expo/static/js/web/entry-*.js under ${dir}: not a finished web export, so an empty result proves nothing`);
    return { hits, scanned };
}

function main() {
    const dir = process.argv[2];
    if (!dir) {
        console.error('usage: ipFixtureShipGuard.mjs <export-dir>');
        process.exit(2);
    }
    const marker = readFixtureMarker();
    const needles = [marker, ...EXTRA_SENTINELS];
    let result;
    try {
        result = scanForNeedles(resolve(dir), needles);
    } catch (error) {
        console.error(`ship guard: cannot judge this folder: ${error.message}`);
        process.exit(2);
    }
    console.log(`scanned ${result.scanned} files under ${resolve(dir)}`);
    let failed = 0;
    for (const [needle, files] of result.hits) {
        if (files.length === 0) continue;
        failed += 1;
        console.log(`ship guard: FAIL, ${files.length} file(s) contain ${JSON.stringify(needle)}:`);
        for (const file of files) console.log(`  ${file}`);
    }
    if (failed === 0) {
        console.log(`ship guard: PASS, 0 files contain the marker ${marker} or any of the ${EXTRA_SENTINELS.length} other fixture strings`);
        return;
    }
    process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
