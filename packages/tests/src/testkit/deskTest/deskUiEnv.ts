/** The folder the exported desk treats as the coordinator's: a session started here is the coordinator. */
export const DESK_COORDINATOR_PATH = '/tmp/desk-e2e-coordinator';

// Both export and browser startup spread this object over process.env. Resolve once here so
// an owned run uses the same directory in both, without allowing paths into the shared exporter.
const exportNamespace = process.env.HAPPIER_E2E_UI_WEB_EXPORT_NAMESPACE ?? 'desk';
if (!/^[A-Za-z0-9]/.test(exportNamespace) || /[^A-Za-z0-9_-]/.test(exportNamespace)) {
    throw new Error('HAPPIER_E2E_UI_WEB_EXPORT_NAMESPACE must be a single directory name: letters, digits, underscores or hyphens, starting with a letter or digit');
}

/**
 * The one UI build the desk specs share. Part of the export's cache key, so `desk:export` and the
 * specs must use the same set. Analytics is denied at build time so it never calls out.
 */
export const DESK_UI_ENV = {
    EXPO_PUBLIC_HAPPIER_BUILD_FEATURES_DENY: 'app.analytics',
    EXPO_PUBLIC_IP_COORDINATOR_PATH: DESK_COORDINATOR_PATH,
    HAPPIER_E2E_UI_WEB_MODE: 'export',
    HAPPIER_E2E_UI_WEB_EXPORT_FALLBACK_TO_METRO: '0',
    HAPPIER_E2E_UI_WEB_EXPORT_NAMESPACE: exportNamespace,
} as const;
