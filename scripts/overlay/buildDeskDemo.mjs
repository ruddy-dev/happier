#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { demoFiles, reportDeskDemo, scanDeskDemo } from './deskDemoGuard.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export function parseArgs(args, root = ROOT) {
    if (args.length > 2) throw new Error('usage: buildDeskDemo.mjs [output-folder] [base-path]');
    const base = args[1] ?? '/desk-demo/';
    if (!/^\/(?:[a-z0-9_-]+\/)*[a-z0-9_-]*\/?$/i.test(base) || base.includes('//')) {
        throw new Error('base path must be an absolute URL path with plain segments, e.g. /desk-demo/');
    }
    const basePath = base.endsWith('/') ? base : `${base}/`;
    const outdir = resolve(root, args[0] ?? '.project/tmp/desk-demo');
    const rel = relative(root, outdir);
    // Never let Expo overwrite a checkout or source folder. External output folders must also be new.
    if (!rel || rel === '..' || outdir === resolve(sep) || ['apps', 'packages', 'scripts', 'node_modules', '.git', '.agents'].includes(rel.split(sep)[0])) {
        throw new Error('output must be a new export folder outside source directories');
    }
    return { outdir, basePath };
}

export function resolveWatchFolders(root) {
    const roots = [join(root, 'node_modules'), join(root, 'apps/ui/node_modules')];
    // Linked worktrees can have real module directories containing package-level symlinks.
    // Resolve a required hoisted package and the app's Expo launcher, not just their parent folders.
    const installed = [join(root, 'node_modules/expo-constants'), join(root, 'apps/ui/node_modules/expo')];
    return [...new Set([...roots.map(path => realpathSync(path)), ...installed.map(path => dirname(realpathSync(path)))])];
}

export function demoEnvironment(inherited, basePath, cache, watchFolders) {
    const env = Object.fromEntries(Object.entries(inherited).filter(([key]) => !/^(?:HAPPIER_|HAPPY_|EXPO_|RCT_METRO|METRO_|SENTRY_)/.test(key)));
    return { ...env, CI: '1', NODE_ENV: 'production', EXPO_NO_TELEMETRY: '1', EXPO_NO_DOTENV: '1', EXPO_OFFLINE: '1',
        EXPO_UNSTABLE_WEB_MODAL: '1', EXPO_PUBLIC_DEBUG: '1', EXPO_PUBLIC_IP_FIXTURES: '1',
        EXPO_BASE_URL: basePath === '/' ? '' : basePath.slice(0, -1),
        EXPO_APP_LOCAL_CONFIG_PATH: join(cache, 'app.local.cjs'),
        EXPO_PUBLIC_HAPPIER_SERVER_URL: '', EXPO_PUBLIC_HAPPY_SERVER_URL: '', EXPO_PUBLIC_SERVER_URL: '',
        EXPO_PUBLIC_HAPPY_STORAGE_SCOPE: '', EXPO_PUBLIC_HAPPIER_SYNC_TUNING_JSON: '',
        EXPO_PUBLIC_HAPPIER_BUILD_FEATURES_DENY: 'app.analytics',
        HAPPIER_METRO_EXTRA_WATCH_FOLDERS: watchFolders.join(delimiter), TMPDIR: cache };
}

export function postProcessExport(dir, basePath) {
    const index = join(dir, 'index.html');
    let html = readFileSync(index, 'utf8');
    const script = `<script src="${basePath}desk-demo-entry.js"></script>`;
    if (!html.includes(script)) html = html.replace(/<script\b/i, `${script}<script`);
    if (!html.includes(script)) throw new Error('export index has no script entry');
    // A hosted demo does not offer installation of the upstream PWA at the site's root.
    html = html.replace(/<link\b(?=[^>]*\brel=["']manifest["'])[^>]*>\s*/gi, '');
    html = html.replace(/((?:src|href)=["'])\/(?!\/)([^"']*)/gi, (match, attr, path) =>
        path.startsWith(basePath.slice(1)) ? match : `${attr}${basePath}${path}`);
    html = html.replace(/<title>[^<]*<\/title>/i, '<title>Sleeper Agents demo</title>');
    writeFileSync(index, html);
    const route = join(dir, 'dev/desk-fixture');
    mkdirSync(route, { recursive: true });
    writeFileSync(join(route, 'index.html'), html);
    // Run before Expo Router initializes. The real document remains reloadable on directory-index hosts.
    writeFileSync(join(dir, 'desk-demo-entry.js'), `history.replaceState(null, '', ${JSON.stringify(`${basePath}dev/desk-fixture/?data=demo`)});\n`);
    for (const file of demoFiles(dir)) {
        if (!/\.(?:js|css|html)$/.test(file)) continue;
        const before = readFileSync(file, 'utf8');
        // The overlay's self-hosted font URL is deliberately root-relative in the regular app.
        const after = before.replace(/(["'])(\/ignore-previous\/[^"']*|\/favicon(?:-active)?\.ico)\1/g,
            (_match, quote, path) => `${quote}${basePath}${path.slice(1)}${quote}`);
        if (after !== before) writeFileSync(file, after);
    }
}

export function buildDeskDemo(args = process.argv.slice(2)) {
    const { outdir, basePath } = parseArgs(args);
    if (existsSync(outdir)) throw new Error('output folder already exists; choose a new folder to preserve previous work');
    const tmp = join(ROOT, '.project/tmp');
    mkdirSync(tmp, { recursive: true });
    const cache = mkdtempSync(join(tmp, 'desk-demo-metro-'));
    // Bypass optional machine-local app overrides as well as dotenv.
    writeFileSync(join(cache, 'app.local.cjs'), 'module.exports = {};\n');
    const watchFolders = resolveWatchFolders(ROOT);
    try {
        const result = spawnSync(process.execPath, [join(ROOT, 'apps/ui/node_modules/expo/bin/cli'), 'export', '--platform', 'web', '--clear', '--output-dir', outdir], {
            cwd: join(ROOT, 'apps/ui'), env: demoEnvironment(process.env, basePath, cache, watchFolders), stdio: 'inherit',
        });
        if (result.error) throw result.error;
        if (result.status !== 0) throw new Error(`Expo export failed (${result.signal ?? result.status})`);
    } finally {
        // This invocation created the directory; no shared Metro cache is touched.
        rmSync(cache, { recursive: true, force: true });
    }
    postProcessExport(outdir, basePath);
    const guard = scanDeskDemo(outdir, basePath);
    reportDeskDemo(guard);
    if (guard.failures.length) throw new Error('demo guard rejected export; folder is not safe to publish');
    const sizes = [...demoFiles(outdir)].map(file => ({ file: relative(outdir, file), bytes: readFileSync(file).length }));
    console.log(JSON.stringify({ outdir, basePath, totalBytes: sizes.reduce((sum, file) => sum + file.bytes, 0), largest: sizes.sort((a, b) => b.bytes - a.bytes).slice(0, 10) }, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try { buildDeskDemo(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
