#!/usr/bin/env node
// Copies the `ignorePrevious` strings block from en.ts into every other locale, so
// i18n.integrity.test.ts sees the same key structure everywhere. Other locales carry
// the English text. See OVERLAY.md.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OPEN = '    ignorePrevious: {';
const CLOSE = '    },';

function findBlock(lines) {
    const start = lines.findIndex((line) => line === OPEN);
    if (start < 0) return null;
    const end = lines.findIndex((line, i) => i > start && line === CLOSE);
    if (end < 0) throw new Error('ignorePrevious block has no closing "    }," line');
    return { start, end };
}

function findMainObjectClose(lines) {
    const open = lines.findIndex((line) => /^export const [A-Za-z]+(: \w+)? = \{$/.test(line));
    if (open < 0) throw new Error('no "export const <locale> = {" line');
    const close = lines.findIndex((line, i) => i > open && /^\}/.test(line));
    if (close < 0) throw new Error('main locale object never closes');
    return close;
}

export function syncOverlayStrings(enSource, localeSource) {
    const enLines = enSource.split('\n');
    const enBlock = findBlock(enLines);
    if (!enBlock) throw new Error('en.ts has no ignorePrevious block');
    const block = enLines.slice(enBlock.start, enBlock.end + 1);

    const lines = localeSource.split('\n');
    const existing = findBlock(lines);
    if (existing) {
        lines.splice(existing.start, existing.end - existing.start + 1, ...block);
        return lines.join('\n');
    }
    const close = findMainObjectClose(lines);
    let prev = close - 1;
    while (prev >= 0 && lines[prev].trim() === '') prev--;
    if (prev >= 0 && !lines[prev].endsWith(',') && !lines[prev].endsWith('{')) lines[prev] += ',';
    lines.splice(close, 0, ...block);
    return lines.join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const dir = join(dirname(fileURLToPath(import.meta.url)), '../../apps/ui/sources/text/translations');
    const en = readFileSync(join(dir, 'en.ts'), 'utf8');
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.ts') && f !== 'en.ts')) {
        const path = join(dir, file);
        const before = readFileSync(path, 'utf8');
        const after = syncOverlayStrings(en, before);
        if (after !== before) writeFileSync(path, after);
        console.log(`${after === before ? 'unchanged' : 'updated  '} ${file}`);
    }
}
