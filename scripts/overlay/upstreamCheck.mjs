#!/usr/bin/env node
// Upkeep check for the Ignore Previous overlay. Reports the stable tag in use, the latest
// upstream stable tag, the upstream files the overlay patches, and whether merging the
// latest tag would conflict. Read-only: it never pushes or moves a branch. See OVERLAY.md.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSIONED = /^refs\/tags\/(ui-web-v\d+\.\d+\.\d+)$/;

function refCommits(refLines) {
    const commits = new Map();
    for (const line of refLines) {
        const [sha, rawRef] = line.trim().split(/\s+/);
        if (!sha || !rawRef) continue;
        const peeled = rawRef.endsWith('^{}');
        const ref = peeled ? rawRef.slice(0, -3) : rawRef;
        if (peeled || !commits.has(ref)) commits.set(ref, sha);
    }
    return commits;
}

export function pickStableTag(refLines) {
    const commits = refCommits(refLines);
    const stable = commits.get('refs/tags/ui-web-stable');
    if (!stable) return null;
    const matches = [...commits].flatMap(([ref, sha]) => {
        const m = VERSIONED.exec(ref);
        return m && sha === stable ? [m[1]] : [];
    });
    matches.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    return matches.at(-1) ?? null;
}

export function listPatchedUpstreamFiles(nameStatus) {
    const paths = [];
    for (const line of nameStatus.split('\n')) {
        const [status, first] = line.split('\t');
        if (!status || !first) continue;
        if (/^[MDR]/.test(status)) paths.push(first);
    }
    return paths.sort();
}

function git(args, opts = {}) {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
}

function main() {
    const base = process.env.OVERLAY_BASE_BRANCH ?? 'fork/stable-base';
    const head = process.env.OVERLAY_HEAD ?? 'HEAD';
    // Upstream moves rolling tags (ui-web-stable, *-dev), so local copies must be force-updated.
    git(['fetch', '--quiet', '--tags', '--force', 'upstream']);
    git(['fetch', '--quiet', 'fork']);
    const refLines = git(['show-ref', '--tags', '-d']).split('\n');
    const latest = pickStableTag(refLines);
    const baseSha = git(['rev-parse', base]).trim();
    const current = [...refCommits(refLines)].flatMap(([ref, sha]) => {
        const m = VERSIONED.exec(ref);
        return m && sha === baseSha ? [m[1]] : [];
    }).at(-1) ?? `(untagged ${baseSha.slice(0, 10)})`;
    console.log(`current: ${current}`);
    console.log(`latest:  ${latest ?? '(no ui-web-stable tag found)'}`);

    const patched = listPatchedUpstreamFiles(git(['diff', '--name-status', `${base}..${head}`]));
    console.log(`patched upstream files (${patched.length}):`);
    for (const p of patched) console.log(`  ${p}`);

    if (!latest || latest === current) {
        console.log('merge:   nothing new to merge');
        return;
    }
    const dir = mkdtempSync(join(tmpdir(), 'overlay-merge-'));
    try {
        git(['worktree', 'add', '--quiet', '--detach', dir, head]);
        try {
            git(['merge', '--no-commit', '--no-ff', latest], { cwd: dir });
            console.log(`merge:   clean (${latest} into ${head})`);
        } catch {
            const conflicts = git(['diff', '--name-only', '--diff-filter=U'], { cwd: dir }).trim();
            console.log(`merge:   conflicts\n${conflicts.split('\n').map((p) => `  ${p}`).join('\n')}`);
            process.exitCode = 1;
        }
    } finally {
        git(['worktree', 'remove', '--force', dir]);
        rmSync(dir, { recursive: true, force: true });
    }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
