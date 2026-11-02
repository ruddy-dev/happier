#!/usr/bin/env node
// Ship guard for the desk fixture: a web export made WITHOUT EXPO_PUBLIC_IP_FIXTURES=1 must carry nothing of it.
// Usage: node scripts/overlay/ipFixtureShipGuard.mjs <export-dir>
// Exit 0: clean. Exit 1: a fixture string is in the output. Exit 2: bad usage, or the folder is not a usable web
// export (missing local scripts or anything other than one Expo web entry in index.html), so an
// empty result would prove nothing.
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

// Tokenize complete tags before inspecting attributes, so quoted markup and comments cannot become scripts.
// Raw-text elements consume their bodies: text inside JavaScript/CSS is not HTML markup.
function scriptSources(html) {
    const sources = [];
    const tags = /<!--[\s\S]*?(?:-->|$)|<![^>]*>|<\/?([a-z][a-z0-9:-]*)\b((?:[^>"']|"[^"']*"|'[^']*')*)>/gi;
    let tag;
    while ((tag = tags.exec(html))) {
        if (!tag[1] || tag[0].startsWith('</')) continue;
        const name = tag[1].toLowerCase();
        // These change script activation or URL resolution and are outside Expo's supported export shape.
        if (['base', 'template', 'plaintext'].includes(name)) throw new Error(`unsupported ${name} element in index.html`);
        if (name === 'script') {
            const attributes = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
            let attribute;
            while ((attribute = attributes.exec(tag[2]))) {
                if (attribute[1].toLowerCase() !== 'src') continue;
                sources.push(attribute[2] ?? attribute[3] ?? attribute[4] ?? '');
                break;
            }
        }
        if (['script', 'style', 'textarea', 'title'].includes(name)) {
            const close = new RegExp(`</${name}\\s*>`, 'gi');
            close.lastIndex = tags.lastIndex;
            if (!close.exec(html)) throw new Error(`unclosed ${name} element in index.html`);
            tags.lastIndex = close.lastIndex;
        }
    }
    return sources;
}

function localScriptPath(source) {
    if (!source.trim()) throw new Error('empty script src in index.html');
    const url = new URL(source, 'https://export.invalid/');
    if (url.origin !== 'https://export.invalid') return null;
    return decodeURIComponent(url.pathname).slice(1);
}

/**
 * Files under `dir` containing each needle, and how many files were read. Throws unless `dir` looks like a
 * finished web export (an index.html whose script exists), so a partial export or the wrong folder cannot pass.
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
    let indexHtml = null;
    const present = new Set();
    for (const file of walk(dir)) {
        scanned += 1;
        const relative = file.slice(dir.length + 1).split(sep).join('/');
        const content = readFileSync(file);
        present.add(relative);
        if (relative === 'index.html') indexHtml = content.toString('utf8');
        for (const needle of needles) if (content.includes(needle)) hits.get(needle).push(file);
    }
    if (indexHtml === null) throw new Error(`no index.html under ${dir}: not a finished web export, so an empty result proves nothing`);
    const scripts = scriptSources(indexHtml).map(localScriptPath).filter((path) => path !== null);
    const entries = scripts.filter((path) => /^_expo\/static\/js\/web\/[^/]+\.js$/.test(path));
    if (entries.length !== 1 || scripts.some((script) => !present.has(script))) {
        throw new Error(`index.html under ${dir} must load exactly one Expo web entry and every local script must exist: not a finished web export, so an empty result proves nothing`);
    }
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
