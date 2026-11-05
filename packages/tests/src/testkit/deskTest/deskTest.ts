import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, test as base, type Page } from '@playwright/test';

import { createRunDirs } from '../runDir';
import { createTestAuthMtls } from '../auth';
import { runDeskServerFixture, type DeskServerForFile } from './deskServer';
import { isUiWebExportCurrent, startUiWebExport } from '../process/uiWebExport';
import { collectBrowserDiagnostics } from '../uiE2e/browserDiagnostics';
import { startForwardedHeaderProxy } from '../uiE2e/forwardedHeaderProxy';
import { normalizeLoopbackBaseUrl } from '../uiE2e/pageNavigation';
import { createEncryptedDeskAccount } from './deskEncryptedAccount';
import { collectEncryptedDeskDiagnostics, encryptedDeskGuardError, encryptedDeskSignupError } from './deskEncryptedDiagnostics';
import { assertDeskRejectsPlainSession } from './deskStorageProof';
import { DESK_UI_ENV } from './deskUiEnv';
import type { BlockedRequest } from './deskRequestGuard';
import { runDeskGuardFixture } from './deskGuardFixture';
export type { BlockedRequest } from './deskRequestGuard';
export { openDesk } from './openDesk';

export type DeskTestOptions = {
    deskEncryptionMode: 'plain' | 'e2ee';
    /** Origins the page may reach, besides the configured `baseURL`. */
    deskAllowedOrigins: string[];
    /** Throwaway probe servers only. Real forbidden hosts are always refused. */
    deskExtraForbiddenOrigins: string[];
};

type DeskGuardFixtures = {
    /** Requests the guard refused so far; the fixture fails the test if any remain at the end. */
    blockedRequests: BlockedRequest[];
};

/**
 * Playwright `test` with the request guard alone: every request and websocket from the page must go
 * to an origin the test lists. Anything else is aborted and fails the test, naming the URL and why
 * it was refused.
 */
export const deskGuardTest = base.extend<DeskGuardFixtures & DeskTestOptions>({
    deskEncryptionMode: ['plain', { option: true }],
    deskAllowedOrigins: [[], { option: true }],
    deskExtraForbiddenOrigins: [[], { option: true }],
    blockedRequests: [
        runDeskGuardFixture,
        { auto: true },
    ],
});

/** The account a desk test seeds through and the browser signs in to. */
export type DeskAccount = Readonly<{ serverBaseUrl: string; proxyBaseUrl: string; token: string; uiBaseUrl: string; encryption?: Readonly<{ contentPublicKey: Uint8Array }>; openAuthenticatedPage?: (page: Page) => Promise<void> }>;

type DeskFixtures = { deskStack: DeskAccount; desk: DeskAccount; deskDiagnostics: () => string };
type DeskWorkerFixtures = { deskServerForFile: DeskServerForFile };

const run = createRunDirs({ runLabel: 'ui-e2e-desk' });
const IDENTITY_ISSUER = 'CN=Example Root CA';

/** Plain, keyless accounts signed in by forwarded client-cert headers: the cheap login, as in sessionList.attentionStatus.spec.ts. */
const DESK_SERVER_ENV = {
    HAPPIER_SERVER_LOG_LEVEL: 'silent',
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
 * The guard plus a throwaway stack: one `startServerLight` per spec file and mode, and per test a new account,
 * forwarded-header proxy and static UI server over the cached export. Chrome's clock is installed, at
 * the real time, so a time check can `page.clock.fastForward`. Plain remains the default;
 * E2EE opts into a disposable UI-created keyed account. A page error fails the test.
 */
export const deskTest = deskGuardTest.extend<DeskFixtures, DeskWorkerFixtures>({
    blockedRequests: async ({ context, deskAllowedOrigins, deskExtraForbiddenOrigins, baseURL, deskEncryptionMode }, use) => {
        try {
            await runDeskGuardFixture({ context, deskAllowedOrigins, deskExtraForbiddenOrigins, baseURL }, use);
        } catch (error) {
            if (deskEncryptionMode === 'plain') throw error;
            // Playwright transport call logs may include Authorization headers. Keep the guard's
            // failure, but never attach its raw error or cause for an authenticated encrypted run.
            throw encryptedDeskGuardError(error);
        }
    },
    deskServerForFile: [
        async ({}, use) => {
            await runDeskServerFixture(run, DESK_SERVER_ENV, use);
        },
        { scope: 'worker' },
    ],
    deskStack: async ({ deskServerForFile, deskEncryptionMode, trace, screenshot, video }, use, testInfo) => {
        if (deskEncryptionMode === 'e2ee') {
            if (trace !== 'off' || screenshot !== 'off' || video !== 'off') {
                throw new Error('Encrypted desk tests require trace, screenshot and video off before creating credentials');
            }
            // Playwright 1.58 suppresses failure DOM snapshots with this switch.
            process.env.PLAYWRIGHT_NO_COPY_PROMPT = '1';
        }
        const uiEnv = { ...process.env, ...DESK_UI_ENV };
        // The job's reservation doesn't cover a build, so never start one here.
        if (!isUiWebExportCurrent(uiEnv)) {
            throw new Error('The desk export is missing or stale: run `yarn desk:export` as an expo-export job first.');
        }
        const server = await deskServerForFile(testInfo.file, deskEncryptionMode);
        const id = randomUUID();
        const identity = { email: `desk-${id}@example.com`, issuer: IDENTITY_ISSUER, fingerprint: `sha256:${id}` };
        const auth = deskEncryptionMode === 'plain' ? await createTestAuthMtls(server.baseUrl, identity) : { token: '' };
        const proxy = await startForwardedHeaderProxy({
            targetBaseUrl: server.baseUrl,
            identityHeaders: deskEncryptionMode === 'e2ee' ? {} : {
                'x-happier-client-cert-email': identity.email,
                'x-happier-client-cert-issuer': identity.issuer,
                'x-happier-client-cert-sha256': identity.fingerprint,
            },
        });
        const testDir = join(testInfo.outputDir, 'ui');
        await mkdir(testDir, { recursive: true });
        try {
            const ui = await startUiWebExport({ testDir, env: { ...uiEnv, EXPO_PUBLIC_HAPPY_SERVER_URL: proxy.baseUrl }, allowBuild: false });
            try {
                await use({
                    serverBaseUrl: server.baseUrl,
                    token: auth.token,
                    uiBaseUrl: normalizeLoopbackBaseUrl(ui.baseUrl),
                    proxyBaseUrl: proxy.baseUrl,
                });
            } finally {
                await ui.stop().catch(() => {});
            }
        } finally {
            await proxy.stop().catch(() => {});
        }
    },
    desk: async ({ deskStack, deskEncryptionMode, browser, blockedRequests }, use) => {
        // Depending on blockedRequests installs the origin guard before account creation.
        void blockedRequests;
        if (deskEncryptionMode === 'plain') {
            await use(deskStack);
            return;
        }
        // Signup can load an empty desk. Give it a separate, guarded context and destroy
        // it before seeding. The journey keeps its untouched context and real restore UI.
        const signupContext = await browser.newContext({ serviceWorkers: 'block', reducedMotion: 'reduce' });
        let created: Awaited<ReturnType<typeof createEncryptedDeskAccount>> | undefined;
        try {
            await runDeskGuardFixture({
                context: signupContext,
                baseURL: deskStack.uiBaseUrl,
                deskAllowedOrigins: [deskStack.serverBaseUrl, deskStack.proxyBaseUrl],
                deskExtraForbiddenOrigins: [],
            }, async () => {
                const signupPage = await signupContext.newPage();
                created = await createEncryptedDeskAccount(signupPage, deskStack.uiBaseUrl, deskStack.serverBaseUrl);
            });
        } catch (error) {
            throw encryptedDeskSignupError(error, 'UI');
        } finally {
            await signupContext.close();
        }
        if (!created) throw new Error('Disposable account creation did not complete');
        const encryptedDesk = { ...deskStack, ...created };
        await assertDeskRejectsPlainSession(encryptedDesk);
        await use(encryptedDesk);
    },
    baseURL: async ({ deskStack }, use) => {
        await use(deskStack.uiBaseUrl);
    },
    deskAllowedOrigins: async ({ deskStack }, use) => {
        await use([deskStack.serverBaseUrl, deskStack.proxyBaseUrl]);
    },
    deskDiagnostics: [
        async ({ page, deskEncryptionMode }, use, testInfo) => {
            let pageErrorCount = 0;
            page.on('pageerror', () => { pageErrorCount++; });
            const read = deskEncryptionMode === 'e2ee'
                ? collectEncryptedDeskDiagnostics(page)
                : collectBrowserDiagnostics({ page });
            await use(read);
            if (deskEncryptionMode === 'e2ee' || testInfo.status !== testInfo.expectedStatus) {
                await testInfo.attach('browser-diagnostics.md', { body: read(), contentType: 'text/markdown' });
            }
            expect(pageErrorCount, 'the page threw while Luke was looking at it').toBe(0);
        },
        { auto: true },
    ],
    page: async ({ page }, use) => {
        await page.clock.install();
        await use(page);
    },
});
