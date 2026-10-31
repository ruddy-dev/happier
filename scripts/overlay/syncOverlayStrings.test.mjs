import { test } from 'node:test';
import assert from 'node:assert/strict';
import { syncOverlayStrings } from './syncOverlayStrings.mjs';

const en = `export const en = {
    common: {
        ok: 'OK',
    },
    ignorePrevious: {
        title: 'Your turn',
        allow: ({ tool }: { tool: string }) => \`Allow \${tool}\`,
    },
} as const;

export type TranslationStructure = typeof en;
`;

const frWithout = `export const fr: TranslationStructure = {
    common: {
        ok: 'D\\'accord',
    },
} as const;
`;

const frStale = `export const fr: TranslationStructure = {
    common: {
        ok: 'D\\'accord',
    },
    ignorePrevious: {
        title: 'old',
    },
} as const;
`;

const expected = `export const fr: TranslationStructure = {
    common: {
        ok: 'D\\'accord',
    },
    ignorePrevious: {
        title: 'Your turn',
        allow: ({ tool }: { tool: string }) => \`Allow \${tool}\`,
    },
} as const;
`;

test('inserts the block as the last key when missing', () => {
    assert.equal(syncOverlayStrings(en, frWithout), expected);
});

test('replaces a stale block', () => {
    assert.equal(syncOverlayStrings(en, frStale), expected);
});

test('is idempotent', () => {
    assert.equal(syncOverlayStrings(en, expected), expected);
});

test('throws when en has no block', () => {
    assert.throws(() => syncOverlayStrings(frWithout, frWithout), /ignorePrevious/);
});

test('adds the missing comma after the previous last key', () => {
    const frNoComma = `export const fr: TranslationStructure = {
    common: {
        ok: 'D\\'accord',
    }
};
`;
    const out = syncOverlayStrings(en, frNoComma);
    assert.match(out, /    },\n    ignorePrevious: \{\n/);
    assert.match(out, /    },\n};\n$/);
});

test('leaves a derived locale (no object literal) unchanged', () => {
    const derived = `import { zhHans } from './zh-Hans';
export const zhHant: TranslationStructure = deepMerge(zhHans, zhHantOverrides);
`;
    assert.equal(syncOverlayStrings(en, derived), derived);
});

test('ignores column-0 inner closers and inserts before the real end', () => {
    const messy = `export const ca: TranslationStructure = {
    errors: {
        a: 'x',
},

deps: {
        b: 'y',
    },
} as const;
`;
    const out = syncOverlayStrings(en, messy);
    assert.match(out, /deps: \{\n        b: 'y',\n    },\n    ignorePrevious: \{/);
    assert.match(out, /    },\n\} as const;\n$/);
});
