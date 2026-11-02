import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from '@babel/parser';
import traverse from '@babel/traverse';
import { describe, expect, it } from 'vitest';

// Metro blocks `ignorePrevious/fixtures/` unless EXPO_PUBLIC_IP_FIXTURES=1, but a dev bundle does not fold the
// flag check away, so it still tries to resolve the fixture imports. Only an import inside a `try` block is an
// "optional dependency" that Metro lets stay unresolved; without it the dev server fails for every developer
// who has not set the flag (found by a flag-off `expo export --dev`).
const FILES_THAT_LOAD_THE_FIXTURE = [
    '../app/(app)/dev/desk-fixture.tsx',
    '../ignorePrevious/components/CoordinatorPane.tsx',
];

function fixtureImports(file: string): Array<{ source: string; inTry: boolean }> {
    const ast = parse(readFileSync(path.resolve(__dirname, file), 'utf8'), { sourceType: 'module', plugins: ['typescript', 'jsx'] });
    const found: Array<{ source: string; inTry: boolean }> = [];
    const visitTraverse = ((traverse as unknown as { default?: typeof traverse }).default ?? traverse) as typeof traverse;
    visitTraverse(ast, {
        CallExpression(callPath) {
            const isDynamicImport = callPath.node.callee.type === 'Import';
            const isRequire = callPath.node.callee.type === 'Identifier' && callPath.node.callee.name === 'require';
            const arg = callPath.node.arguments[0];
            if (!(isDynamicImport || isRequire) || arg?.type !== 'StringLiteral') return;
            if (!/ignorePrevious\/fixtures|\.\.\/fixtures/.test(arg.value)) return;
            const tryBlock = callPath.findParent((parent) => parent.isBlockStatement() && parent.parentPath?.isTryStatement() === true && parent.key === 'block');
            found.push({ source: arg.value, inTry: tryBlock !== null });
        },
        ImportDeclaration(declPath) {
            if (/ignorePrevious\/fixtures|\.\.\/fixtures/.test(declPath.node.source.value)) {
                found.push({ source: declPath.node.source.value, inTry: false });
            }
        },
    });
    return found;
}

describe('files that load the desk fixture', () => {
    it.each(FILES_THAT_LOAD_THE_FIXTURE)('%s imports it only through an import() inside try', (file) => {
        const imports = fixtureImports(file);
        expect(imports.length).toBeGreaterThan(0);
        for (const found of imports) {
            expect(found, `${found.source} must be a dynamic import inside a try block`).toMatchObject({ inTry: true });
        }
    });
});
