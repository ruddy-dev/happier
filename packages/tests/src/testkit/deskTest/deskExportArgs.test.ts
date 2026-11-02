import { expect, test } from 'vitest';
import { parseDeskExportArgs } from './deskExportArgs';
import { DESK_ENV_KEEP, scrubEnv } from './originGuard';

test('desk export reuses its cache by default and accepts an explicit rebuild', () => {
    expect(parseDeskExportArgs([])).toEqual({ rebuild: false });
    expect(parseDeskExportArgs(['--rebuild'])).toEqual({ rebuild: true });
});

test('an unknown flag fails instead of silently using the cache', () => {
    expect(() => parseDeskExportArgs(['--rebuid'])).toThrow();
});

test('the desk environment preserves the existing export namespace switch', () => {
    const env = { HAPPIER_E2E_UI_WEB_EXPORT_NAMESPACE: 'desk-export-probe', HAPPIER_SERVER_URL: 'https://example.invalid' };
    expect(scrubEnv(env, DESK_ENV_KEEP)).toEqual({ HAPPIER_E2E_UI_WEB_EXPORT_NAMESPACE: 'desk-export-probe' });
});
