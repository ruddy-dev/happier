import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

/** Remove only the desk export's private persisted Metro file maps before a build. */
export async function clearDeskMetroFileMaps(metroTmp: string): Promise<void> {
    const entries = await readdir(metroTmp).catch((error: unknown) => {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return [];
        throw error;
    });
    for (const name of entries) {
        if (name.startsWith('metro-file-map-')) {
            await rm(join(metroTmp, name), { recursive: true, force: true });
        }
    }
}
