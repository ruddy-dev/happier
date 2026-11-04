import { afterEach, expect, test, vi } from 'vitest';

afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
});

test('the shared desk environment defaults to the desk namespace when unset', async () => {
    vi.stubEnv('HAPPIER_E2E_UI_WEB_EXPORT_NAMESPACE', undefined);
    vi.resetModules();
    const { DESK_UI_ENV } = await import('./deskUiEnv');

    expect(DESK_UI_ENV.HAPPIER_E2E_UI_WEB_EXPORT_NAMESPACE).toBe('desk');
});

test('the shared desk environment retains an owned namespace through build and browser env composition', async () => {
    vi.stubEnv('HAPPIER_E2E_UI_WEB_EXPORT_NAMESPACE', 'atr-auth-j3-owned_123');
    vi.stubEnv('EXPO_PUBLIC_HAPPIER_BUILD_FEATURES_DENY', '');
    vi.stubEnv('EXPO_PUBLIC_IP_COORDINATOR_PATH', '/tmp/other-coordinator');
    vi.stubEnv('HAPPIER_E2E_UI_WEB_MODE', 'metro');
    vi.stubEnv('HAPPIER_E2E_UI_WEB_EXPORT_FALLBACK_TO_METRO', '1');
    vi.resetModules();
    const { DESK_UI_ENV } = await import('./deskUiEnv');

    expect({ ...process.env, ...DESK_UI_ENV }).toMatchObject({
        HAPPIER_E2E_UI_WEB_EXPORT_NAMESPACE: 'atr-auth-j3-owned_123',
        EXPO_PUBLIC_HAPPIER_BUILD_FEATURES_DENY: 'app.analytics',
        EXPO_PUBLIC_IP_COORDINATOR_PATH: '/tmp/desk-e2e-coordinator',
        HAPPIER_E2E_UI_WEB_MODE: 'export',
        HAPPIER_E2E_UI_WEB_EXPORT_FALLBACK_TO_METRO: '0',
    });
});

test.each([
    '', ' ', '.', '..', '../other', 'other/../desk', 'other/child', 'other\\child',
    '/tmp/other', 'C:\\temp\\other', 'C:other', '\\\\host\\share',
    ' desk', 'desk ', 'desk\n', '-desk', '_desk',
])('the canonical desk environment rejects unsafe namespace %j before use', async (namespace) => {
    vi.stubEnv('HAPPIER_E2E_UI_WEB_EXPORT_NAMESPACE', namespace);
    vi.resetModules();

    await expect(import('./deskUiEnv')).rejects.toThrow(/HAPPIER_E2E_UI_WEB_EXPORT_NAMESPACE/);
});
