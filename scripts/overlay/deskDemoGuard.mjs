#!/usr/bin/env node
import { readdirSync, readFileSync, lstatSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function* demoFiles(dir) {
    for (const name of readdirSync(dir)) {
        const file = join(dir, name);
        const stat = lstatSync(file);
        if (stat.isSymbolicLink()) throw new Error(`export contains a symlink: ${relative(dir, file)}`);
        if (stat.isDirectory()) yield* demoFiles(file);
        else if (stat.isFile()) yield file;
    }
}

const patterns = [
    ['private host', /ts\.net|127\.0\.0\.1:3005|localhost:3005/gi],
    // Upstream ships sample paths for the users steve and lee and the Linuxbrew prefix; nothing else is allowed.
    ['private path', /\/home\/(?!linuxbrew\/)|\/Users\/(?!(?:steve|lee)\/)|C:\\+Users/gi],
    ['secret', /(?<![\w-])(?:phc_[a-z0-9_-]{20,}|sk-(?=[a-z0-9_-]*\d)[a-z0-9_-]{16,}|ghp_[a-z0-9]{20,}|github_pat_[a-z0-9_]{20,}|AKIA[A-Z0-9]{16})|-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/gi],
    ['non-empty inlined server URL', /EXPO_PUBLIC_[A-Z0-9_]*SERVER_URL["']?\s*[:=]\s*["']\s*[^"'\s][^"']*["']/gi],
];
// Personal names and handles stay out of this public file: the person building supplies them.
export function privateTermsFromEnv(env = process.env) {
    return String(env.DESK_DEMO_PRIVATE_TERMS ?? '').split(',');
}
const escapeRegExp = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const email = /[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/gi;
const placeholder = /^[^@]+@(?:example\.(?:com|org|net)|(?:[^.]+\.)*example|localhost)$/i;
// Licence headers of bundled libraries carry their authors' public addresses.
const publicEmails = new Set(['feross@feross.org']);
// Compressed media yields random email-shaped bytes; every other rule still scans these files.
const media = /\.(?:webp|png|jpe?g|gif|ico|ttf|otf|woff2?|wasm|mp3|wav)$/i;

/** Scan every file, including binary assets. Diagnostics name rules and files, never print secret values. */
export function scanDeskDemo(dir, basePath = '/desk-demo/', privateTerms = privateTermsFromEnv()) {
    dir = resolve(dir);
    const terms = privateTerms.map(term => term.trim()).filter(Boolean);
    const rules = terms.length ? [...patterns, ['private term', new RegExp(terms.map(escapeRegExp).join('|'), 'gi')]] : patterns;
    // Require a usable sub-path export, so scanning an empty/partial folder cannot pass.
    const html = readFileSync(join(dir, 'index.html'), 'utf8');
    const sources = [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)].map(match => match[1]);
    const scripts = sources.map(source => {
        if (!source.startsWith(basePath) || source.startsWith('//')) throw new Error('export script must use the demo base path');
        const path = source.slice(basePath.length);
        if (path.split('/').includes('..') || /[?#%\\]/.test(path)) throw new Error('invalid export script path');
        readFileSync(join(dir, path));
        return path;
    });
    if (scripts.filter(path => /^_expo\/static\/js\/web\/(?!__expo-metro-runtime-|__common-)[^/]+\.js$/.test(path)).length !== 1) {
        throw new Error('export must load one Expo web entry');
    }
    const failures = [];
    const hosts = {};
    let scanned = 0;
    for (const file of demoFiles(dir)) {
        scanned++;
        const body = readFileSync(file).toString('utf8');
        for (const [rule, pattern] of rules) {
            pattern.lastIndex = 0;
            const count = [...body.matchAll(pattern)].length;
            if (count) failures.push({ file: relative(dir, file), rule, count });
        }
        const emails = media.test(file) ? [] : [...body.matchAll(email)].filter(match => !placeholder.test(match[0]) && !publicEmails.has(match[0].toLowerCase()));
        if (emails.length) failures.push({ file: relative(dir, file), rule: 'non-placeholder email', count: emails.length });
        for (const match of body.matchAll(/https:\/\/([a-z0-9.-]+)(?=[:/\s"'<>\\)]|$)/gi)) {
            const host = match[1].toLowerCase();
            hosts[host] = (hosts[host] ?? 0) + 1;
        }
    }
    return { failures, hosts, scanned, privateTerms: terms.length };
}

export function reportDeskDemo(result) {
    for (const hit of result.failures) console.error(`FAIL ${hit.rule}: ${hit.file} (${hit.count})`);
    if (!result.privateTerms) console.warn('WARN no private terms checked (set DESK_DEMO_PRIVATE_TERMS to a comma-separated list)');
    for (const [host, count] of Object.entries(result.hosts).sort()) console.warn(`WARN absolute HTTPS host ${host}: ${count}`);
    console.log(`demo guard: ${result.failures.length ? 'FAIL' : 'PASS'}, ${result.scanned} files scanned`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        if (!process.argv[2] || process.argv.length > 4) throw new Error('usage: deskDemoGuard.mjs <folder> [base-path]');
        const result = scanDeskDemo(process.argv[2], process.argv[3]);
        reportDeskDemo(result);
        process.exitCode = result.failures.length ? 1 : 0;
    } catch (error) { console.error(error.message); process.exitCode = 2; }
}
