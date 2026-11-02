import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';

import { clearDeskMetroFileMaps } from './deskMetroCache';

test('only persisted file-map files and directories are removed from the private Metro temp dir', async () => {
    const root = await mkdtemp(join(tmpdir(), 'desk-metro-test-'));
    const metroTmp = join(root, 'private');
    try {
        await mkdir(metroTmp);
        await writeFile(join(metroTmp, 'metro-file-map-abc'), 'stale map');
        await mkdir(join(metroTmp, 'metro-file-map-directory'));
        await writeFile(join(metroTmp, 'metro-file-map-directory', 'map'), 'stale map');
        await mkdir(join(metroTmp, 'metro-cache'));
        await writeFile(join(metroTmp, 'metro-cache', 'transform'), 'keep');
        await writeFile(join(metroTmp, 'other'), 'keep');
        await writeFile(join(root, 'metro-file-map-outside'), 'keep');
        await clearDeskMetroFileMaps(metroTmp);
        expect((await readdir(metroTmp)).sort()).toEqual(['metro-cache', 'other']);
        expect(await readdir(join(metroTmp, 'metro-cache'))).toEqual(['transform']);
        expect((await readdir(root)).sort()).toEqual(['metro-file-map-outside', 'private']);
        await expect(clearDeskMetroFileMaps(metroTmp)).resolves.toBeUndefined();
        await expect(clearDeskMetroFileMaps(join(root, 'missing'))).resolves.toBeUndefined();
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});
