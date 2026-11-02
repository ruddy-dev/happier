import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { parse } from '@babel/parser';
// Expo's own copy of Metro's dependency collector: the code that decides whether an import is optional.
// eslint-disable-next-line import/no-unresolved
import collectDependencies from '@expo/metro-config/build/transform-worker/collect-dependencies';
import { describe, expect, it } from 'vitest';

// Metro blocks `ignorePrevious/fixtures/` unless EXPO_PUBLIC_IP_FIXTURES=1, but a dev bundle does not fold the
// flag check away, so it still tries to resolve the fixture imports. Only an import Metro counts as an
// "optional dependency" may stay unresolved; otherwise the dev server fails for every developer without the
// flag (found by a flag-off `expo export --dev`). Metro's rule is narrow (the nearest enclosing block, within
// three statements, must be a try's own block), so this spec asks Expo's collector instead of copying the rule.
const SOURCES = path.resolve(__dirname, '..');
const FIXTURES = path.join(SOURCES, 'ignorePrevious', 'fixtures');

const FILES_THAT_LOAD_THE_FIXTURE = [
    path.join(SOURCES, 'app', '(app)', 'dev', 'desk-fixture.tsx'),
    path.join(SOURCES, 'ignorePrevious', 'components', 'CoordinatorPane.tsx'),
];

type Collected = { name: string; isOptional: boolean };

function collect(file: string): Collected[] {
    const ast = parse(readFileSync(file, 'utf8'), { sourceType: 'module', plugins: ['typescript', 'jsx'] });
    const { dependencies } = collectDependencies(ast as never, {
        asyncRequireModulePath: 'asyncRequire',
        dynamicRequires: 'reject',
        inlineableCalls: [],
        keepRequireNames: false,
        allowOptionalDependencies: true,
        unstable_allowRequireContext: false,
        collectOnly: true,
    } as never);
    return dependencies.map((dep) => ({ name: dep.name, isOptional: Boolean((dep.data as { isOptional?: boolean }).isOptional) }));
}

function resolveSpecifier(importer: string, name: string): string | null {
    if (name.startsWith('@/')) return path.join(SOURCES, name.slice(2));
    if (name.startsWith('.')) return path.resolve(path.dirname(importer), name);
    return null;
}

function isInsideFixtures(resolved: string | null): boolean {
    return resolved !== null && (resolved === FIXTURES || resolved.startsWith(FIXTURES + path.sep));
}

function* sourceFiles(dir: string): Generator<string> {
    for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry);
        if (statSync(full).isDirectory()) yield* sourceFiles(full);
        else if (/\.(?:ts|tsx)$/.test(entry) && !/\.(?:test|spec)\.[tj]sx?$/.test(entry)) yield full;
    }
}

describe('files that load the desk fixture', () => {
    it.each(FILES_THAT_LOAD_THE_FIXTURE.map((file) => [path.relative(SOURCES, file), file]))('%s imports it only as an optional dependency (Expo collector)', (_label, file) => {
        const fixtureDeps = collect(file).filter((dep) => isInsideFixtures(resolveSpecifier(file, dep.name)));
        expect(fixtureDeps.length).toBeGreaterThan(0);
        for (const dep of fixtureDeps) {
            expect(dep, `${dep.name} must be optional for Metro (an import() directly inside a try block)`).toMatchObject({ isOptional: true });
        }
    });

    it('no other source file imports the fixtures folder', () => {
        const importers = [...sourceFiles(SOURCES)]
            .filter((file) => !file.startsWith(FIXTURES + path.sep))
            .filter((file) => {
                const source = readFileSync(file, 'utf8');
                if (!source.includes('fixtures')) return false;
                return collect(file).some((dep) => isInsideFixtures(resolveSpecifier(file, dep.name)));
            })
            .sort();
        expect(importers).toEqual([...FILES_THAT_LOAD_THE_FIXTURE].sort());
    });

    it('reads the flag only as an exact comparison with "1", so "0", "true" and "" are all off', () => {
        const reads = [...sourceFiles(SOURCES)].flatMap((file) =>
            readFileSync(file, 'utf8')
                .split('\n')
                .filter((line) => !/^\s*(?:\/\/|\*|\/\*)/.test(line) && line.includes('process.env.EXPO_PUBLIC_IP_FIXTURES'))
                .map((line) => ({ file: path.relative(SOURCES, file), line: line.trim() })),
        );
        expect(reads.length).toBeGreaterThan(0);
        for (const read of reads) {
            expect(read.line, read.file).toMatch(/process\.env\.EXPO_PUBLIC_IP_FIXTURES (?:===|!==) '1'/);
        }
    });
});
