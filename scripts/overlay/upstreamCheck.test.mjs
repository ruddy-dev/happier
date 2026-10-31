import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickStableTag, listPatchedUpstreamFiles } from './upstreamCheck.mjs';

const A = '63829e3cd6a8f1f48b10891af0c8b2313e51ac7e';
const B = '1111111111111111111111111111111111111111';

test('pickStableTag returns the versioned tag sharing the ui-web-stable commit', () => {
    const lines = [
        `${B} refs/tags/ui-web-v0.2.18`,
        `${A} refs/tags/ui-web-v0.2.19`,
        `${A} refs/tags/ui-web-stable`,
        `${A} refs/tags/ui-web-preview`,
    ];
    assert.equal(pickStableTag(lines), 'ui-web-v0.2.19');
});

test('pickStableTag prefers peeled (^{}) commits for annotated tags', () => {
    const lines = [
        `${B} refs/tags/ui-web-v0.2.19`,
        `${A} refs/tags/ui-web-v0.2.19^{}`,
        `${A} refs/tags/ui-web-stable`,
    ];
    assert.equal(pickStableTag(lines), 'ui-web-v0.2.19');
});

test('pickStableTag returns null without ui-web-stable', () => {
    assert.equal(pickStableTag([`${A} refs/tags/ui-web-v0.2.19`]), null);
});

test('listPatchedUpstreamFiles keeps modified, renamed and deleted upstream paths only', () => {
    const out = listPatchedUpstreamFiles('M\tapps/ui/a.ts\nA\tapps/ui/sources/ignorePrevious/x.ts\nR100\told.ts\tnew.ts\nD\tgone.ts\n');
    assert.deepEqual(out, ['apps/ui/a.ts', 'gone.ts', 'old.ts']);
});
