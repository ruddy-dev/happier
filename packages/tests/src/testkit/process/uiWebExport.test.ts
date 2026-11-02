import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, test } from 'vitest';
import { resolveUiWebExportSourceFingerprint } from './uiWebExport';

test('the fingerprint changes when any UI workspace dependency changes, without exporting', () => {
    const root = mkdtempSync(join(tmpdir(), 'desk-fingerprint-'));
    const names = ['protocol', 'agents', 'audio-stream-native', 'cli-common', 'connection-supervisor', 'release-runtime', 'sherpa-native', 'transfers'];
    const put = (file: string, content: string) => {
        mkdirSync(dirname(join(root, file)), { recursive: true });
        writeFileSync(join(root, file), content);
    };
    try {
        put('apps/ui/package.json', JSON.stringify({ dependencies: Object.fromEntries(names.map((name) => [`@happier-dev/${name}`, '0.0.0'])) }));
        put('apps/ui/sources/index.ts', 'export const ui = 1;');
        for (const name of names) {
            put(`packages/${name}/package.json`, JSON.stringify({ name: `@happier-dev/${name}` }));
            put(`packages/${name}/src/index.ts`, 'export const shared = 1;');
        }
        let previous = resolveUiWebExportSourceFingerprint(root);
        expect(resolveUiWebExportSourceFingerprint(root)).toBe(previous);
        for (const name of names) {
            put(`packages/${name}/src/index.ts`, 'export const shared = 12345;');
            const next = resolveUiWebExportSourceFingerprint(root);
            expect(next, `${name} must invalidate the cached export`).not.toBe(previous);
            previous = next;
        }
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});
