#!/usr/bin/env node
// Ship guard for the desk fixture: a web export made WITHOUT EXPO_PUBLIC_IP_FIXTURES=1 must not contain
// the fixture marker anywhere. Usage: node scripts/overlay/ipFixtureShipGuard.mjs <export-dir>
//
// The export must be cold. Metro's transform cache ignores EXPO_PUBLIC_* values, so a warm cache that
// last saw the flag on can hand back a bundle that still carries the fixture (a false pass here).
// ~/dev/tools/happier-wt/export.sh keeps one cache per env set; delete that cache dir for a cold run.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const FIXTURE_SCENARIO = join(
    dirname(fileURLToPath(import.meta.url)),
    '../../apps/ui/sources/ignorePrevious/fixtures/desk-fixture.json',
);

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

/** Files under `dir` containing `marker`, and how many files were read. Throws on an export with no JavaScript. */
export function scanForMarker(dir, marker) {
    let isDir = false;
    try {
        isDir = statSync(dir).isDirectory();
    } catch {
        // reported below
    }
    if (!isDir) throw new Error(`export folder not found: ${dir}`);
    const hits = [];
    let scanned = 0;
    let scripts = 0;
    for (const file of walk(dir)) {
        scanned += 1;
        if (file.endsWith('.js')) scripts += 1;
        if (readFileSync(file).includes(marker)) hits.push(file);
    }
    if (scripts === 0) throw new Error(`no JavaScript under ${dir}: not a web export, so an empty result proves nothing`);
    return { hits, scanned };
}

function main() {
    const dir = process.argv[2];
    if (!dir) {
        console.error('usage: ipFixtureShipGuard.mjs <export-dir>');
        process.exit(2);
    }
    const marker = readFixtureMarker();
    const { hits, scanned } = scanForMarker(resolve(dir), marker);
    console.log(`scanned ${scanned} files under ${resolve(dir)}`);
    if (hits.length === 0) {
        console.log(`ship guard: PASS, 0 files contain ${marker}`);
        return;
    }
    console.log(`ship guard: FAIL, ${hits.length} file(s) contain ${marker}:`);
    for (const hit of hits) console.log(`  ${hit}`);
    process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
