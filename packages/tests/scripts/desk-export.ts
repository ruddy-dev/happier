// Builds the UI export the desk specs serve, as its own hw-run job (expo-export), and does nothing if
// the cached one still matches. Run through `yarn desk:export`, which scrubs the environment first.
import { mkdirSync, mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';

import { clearDeskMetroFileMaps } from '../src/testkit/deskTest/deskMetroCache';
import { DESK_UI_ENV } from '../src/testkit/deskTest/deskUiEnv';
import { isUiWebExportCurrent, startUiWebExport } from '../src/testkit/process/uiWebExport';

const repoRoot = resolve(import.meta.dirname, '../../..');

// A linked worktree's node_modules are symlinks into the primary install, which Metro must also watch.
const installRoot = dirname(dirname(realpathSync(join(repoRoot, 'node_modules/expo'))));
const extraWatchFolders = installRoot === repoRoot
    ? {}
    : { HAPPIER_METRO_EXTRA_WATCH_FOLDERS: [join(installRoot, 'node_modules'), join(installRoot, 'apps/ui/node_modules')].join(delimiter) };

// Metro keeps its cache under TMPDIR: a private one stays clear of any dev server's /tmp/metro-cache.
const metroTmp = join(repoRoot, '.project/tmp/desk-metro-tmp');
mkdirSync(metroTmp, { recursive: true });

const env = {
    ...process.env,
    ...DESK_UI_ENV,
    ...extraWatchFolders,
    TMPDIR: metroTmp,
    HAPPIER_E2E_UI_WEB_EXPORT_TIMEOUT_MS: '1500000',
};
const cached = isUiWebExportCurrent(env);
// Persisted maps can be stale across runs with linked node_modules. Keep transform caches.
if (!cached) await clearDeskMetroFileMaps(metroTmp);
const started = Date.now();
const ui = await startUiWebExport({ testDir: mkdtempSync(join(tmpdir(), 'desk-export-')), env });
await ui.stop();
console.log(cached ? 'desk export: cache hit, nothing built' : `desk export: built in ${Math.round((Date.now() - started) / 1000)} s`);
