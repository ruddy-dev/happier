import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { basename, join } from 'node:path';

import { expect, test as base, type Page } from '@playwright/test';

import { createTestAuthMtls } from '../auth';
import { startServerLight, type StartedServer } from '../process/serverLight';
import { startUiWeb } from '../process/uiWeb';
import { isUiWebExportCurrent } from '../process/uiWebExport';
import { createRunDirs } from '../runDir';
import { collectBrowserDiagnostics } from '../uiE2e/browserDiagnostics';
import { startForwardedHeaderProxy } from '../uiE2e/forwardedHeaderProxy';
import { gotoDomContentLoadedWithRetries, normalizeLoopbackBaseUrl } from '../uiE2e/pageNavigation';
import { waitForInitialAppUi } from '../uiE2e/waitForInitialAppUi';
import { DESK_UI_ENV } from './deskUiEnv';
import { assertServerPort, forbiddenOriginLabel, isAllowedOrigin } from './originGuard';
import { assertNoBlockedRequests, guardDeskRoute, type BlockedRequest } from './deskRequestGuard';
export type { BlockedRequest } from './deskRequestGuard';

export type DeskTestOptions = {
    /** Origins the page may reach, besides the configured `baseURL`. */
    deskAllowedOrigins: string[];
    /** Throwaway probe servers only. Real forbidden hosts are always refused. */
    deskExtraForbiddenOrigins: string[];
};

type DeskGuardFixtures = {
    /** Requests the guard refused so far; the fixture fails the test if any remain at the end. */
    blockedRequests: BlockedRequest[];
};

function refusalReason(url: string, extraForbidden: readonly string[]): string {
    return forbiddenOriginLabel(url, extraForbidden) ?? 'not on the allowed list';
}

/**
 * Playwright `test` with the request guard alone: every request and websocket from the page must go
 * to an origin the test lists. Anything else is aborted and fails the test, naming the URL and why
 * it was refused.
 */
export const deskGuardTest = base.extend<DeskGuardFixtures & DeskTestOptions>({
    deskAllowedOrigins: [[], { option: true }],
    deskExtraForbiddenOrigins: [[], { option: true }],
    blockedRequests: [
        async ({ context, deskAllowedOrigins, deskExtraForbiddenOrigins, baseURL }, use) => {
            const allowed = baseURL ? [baseURL, ...deskAllowedOrigins] : deskAllowedOrigins;
            const blocked: BlockedRequest[] = [];
            await context.route('**/*', (route) => guardDeskRoute(route, context.request, allowed, blocked, deskExtraForbiddenOrigins));
            await context.routeWebSocket(() => true, async (socket) => {
                const url = socket.url();
                if (isAllowedOrigin(url, allowed, deskExtraForbiddenOrigins)) {
                    socket.connectToServer();
                    return;
                }
                blocked.push({ url, reason: refusalReason(url, deskExtraForbiddenOrigins) });
                await socket.close();
            });
            await use(blocked);
            assertNoBlockedRequests(blocked);
        },
        { auto: true },
    ],
});

/** The account a desk test seeds through and the browser signs in to. */
export type DeskAccount = Readonly<{ serverBaseUrl: string; proxyBaseUrl: string; token: string; uiBaseUrl: string }>;

type DeskFixtures = { desk: DeskAccount; deskDiagnostics: () => string };
type DeskWorkerFixtures = { deskServerForFile: (file: string) => Promise<StartedServer> };

const run = createRunDirs({ runLabel: 'ui-e2e-desk' });
const IDENTITY_ISSUER = 'CN=Example Root CA';

/** Plain, keyless accounts signed in by forwarded client-cert headers: the cheap login, as in sessionList.attentionStatus.spec.ts. */
const DESK_SERVER_ENV = {
    HAPPIER_BUILD_FEATURES_DENY: 'sharing.contentKeys',
    HAPPIER_FEATURE_AUTH_LOGIN__KEY_CHALLENGE_ENABLED: '0',
    AUTH_ANONYMOUS_SIGNUP_ENABLED: '0',
    AUTH_SIGNUP_PROVIDERS: '',
    HAPPIER_FEATURE_E2EE__KEYLESS_ACCOUNTS_ENABLED: '1',
    HAPPIER_FEATURE_ENCRYPTION__STORAGE_POLICY: 'optional',
    HAPPIER_FEATURE_ENCRYPTION__DEFAULT_ACCOUNT_MODE: 'plain',
    HAPPIER_FEATURE_AUTH_MTLS__ENABLED: '1',
    HAPPIER_FEATURE_AUTH_MTLS__MODE: 'forwarded',
    HAPPIER_FEATURE_AUTH_MTLS__TRUST_FORWARDED_HEADERS: '1',
    HAPPIER_FEATURE_AUTH_MTLS__AUTO_PROVISION: '1',
    HAPPIER_FEATURE_AUTH_MTLS__IDENTITY_SOURCE: 'san_email',
    HAPPIER_FEATURE_AUTH_MTLS__ALLOWED_EMAIL_DOMAINS: 'example.com',
    HAPPIER_FEATURE_AUTH_MTLS__ALLOWED_ISSUERS: IDENTITY_ISSUER,
    HAPPIER_FEATURE_AUTH_MTLS__FORWARDED_EMAIL_HEADER: 'x-happier-client-cert-email',
    HAPPIER_FEATURE_AUTH_MTLS__FORWARDED_ISSUER_HEADER: 'x-happier-client-cert-issuer',
    HAPPIER_FEATURE_AUTH_MTLS__FORWARDED_FINGERPRINT_HEADER: 'x-happier-client-cert-sha256',
    HAPPIER_FEATURE_AUTH_UI__AUTO_REDIRECT_ENABLED: '1',
    HAPPIER_FEATURE_AUTH_UI__AUTO_REDIRECT_PROVIDER_ID: 'mtls',
} as const;

/**
 * The guard plus a throwaway stack: one `startServerLight` per spec file, and per test a new account,
 * forwarded-header proxy and static UI server over the cached export. Chrome's clock is installed, at
 * the real time, so a time check can `page.clock.fastForward`. A page error fails the test.
 */
export const deskTest = deskGuardTest.extend<DeskFixtures, DeskWorkerFixtures>({
    deskServerForFile: [
        async ({}, use) => {
            let current: Readonly<{ file: string; server: StartedServer }> | null = null;
            await use(async (file) => {
                if (current?.file === file) return current.server;
                await current?.server.stop();
                current = null;
                const testDir = run.testDir(basename(file));
                await mkdir(testDir, { recursive: true });
                const server = await startServerLight({ testDir, dbProvider: 'sqlite', extraEnv: DESK_SERVER_ENV });
                assertServerPort(Number(new URL(server.baseUrl).port));
                current = { file, server };
                return server;
            });
            await (current as Readonly<{ server: StartedServer }> | null)?.server.stop();
        },
        { scope: 'worker' },
    ],
    desk: async ({ deskServerForFile }, use, testInfo) => {
        const uiEnv = { ...process.env, ...DESK_UI_ENV };
        // The job's reservation doesn't cover a build, so never start one here.
        if (!isUiWebExportCurrent(uiEnv)) {
            throw new Error('The desk export is missing or stale: run `yarn desk:export` as an expo-export job first.');
        }
        const server = await deskServerForFile(testInfo.file);
        const id = randomUUID();
        const identity = { email: `desk-${id}@example.com`, issuer: IDENTITY_ISSUER, fingerprint: `sha256:${id}` };
        const auth = await createTestAuthMtls(server.baseUrl, identity);
        const proxy = await startForwardedHeaderProxy({
            targetBaseUrl: server.baseUrl,
            identityHeaders: {
                'x-happier-client-cert-email': identity.email,
                'x-happier-client-cert-issuer': identity.issuer,
                'x-happier-client-cert-sha256': identity.fingerprint,
            },
        });
        const testDir = join(testInfo.outputDir, 'ui');
        await mkdir(testDir, { recursive: true });
        const ui = await startUiWeb({ testDir, env: { ...uiEnv, EXPO_PUBLIC_HAPPY_SERVER_URL: proxy.baseUrl } });
        try {
            await use({
                serverBaseUrl: server.baseUrl,
                token: auth.token,
                uiBaseUrl: normalizeLoopbackBaseUrl(ui.baseUrl),
                proxyBaseUrl: proxy.baseUrl,
            });
        } finally {
            await ui.stop().catch(() => {});
            await proxy.stop().catch(() => {});
        }
    },
    baseURL: async ({ desk }, use) => {
        await use(desk.uiBaseUrl);
    },
    deskAllowedOrigins: async ({ desk }, use) => {
        await use([desk.serverBaseUrl, desk.proxyBaseUrl]);
    },
    deskDiagnostics: [
        async ({ page }, use, testInfo) => {
        const errors: string[] = [];
        page.on('pageerror', (error) => errors.push(String(error)));
        const read = collectBrowserDiagnostics({ page });
        await use(read);
        if (testInfo.status !== testInfo.expectedStatus) {
            await testInfo.attach('browser-diagnostics.md', { body: read(), contentType: 'text/markdown' });
        }
        expect(errors, 'the page threw while Luke was looking at it').toEqual([]);
    },
        { auto: true },
    ],
    page: async ({ page }, use) => {
        await page.clock.install();
        await use(page);
    },
});

/** Signs in on the plain login, then opens the desk with a fresh load, as Luke does each morning. */
export async function openDesk(page: Page, desk: DeskAccount): Promise<void> {
    await gotoDomContentLoadedWithRetries(page, `${desk.uiBaseUrl}/?happier_hmr=0`, 180_000);
    await waitForInitialAppUi({ page, timeoutMs: 120_000 });
    await gotoDomContentLoadedWithRetries(page, `${desk.uiBaseUrl}/desk`, 120_000);
}
