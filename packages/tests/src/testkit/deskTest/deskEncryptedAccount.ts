import { expect, type Page } from '@playwright/test';
import tweetnacl from 'tweetnacl';
import { deriveAccountMachineKeyFromRecoverySecret } from '@happier-dev/protocol';

import { encryptedDeskSignupError, type EncryptedDeskSignupStep } from './deskEncryptedDiagnostics';
import { fetchJson } from '../http';
import { gotoDomContentLoadedWithRetries } from '../uiE2e/pageNavigation';
import { waitForInitialAppUi } from '../uiE2e/waitForInitialAppUi';

/** Read only the disposable browser credentials, never include them in assertion output. */
export async function readDeskCredentials(page: Page) {
    return page.evaluate(() => {
        for (let index = 0; index < localStorage.length; index++) {
            const key = localStorage.key(index);
            if (!key?.startsWith('auth_credentials')) continue;
            const raw = localStorage.getItem(key);
            if (!raw) continue;
            let value: unknown;
            try { value = JSON.parse(raw); } catch { continue; }
            if (!value || typeof value !== 'object' || !('token' in value) || !('secret' in value)) continue;
            if (typeof value.token === 'string' && typeof value.secret === 'string') return { token: value.token, secret: value.secret };
        }
        return null;
    });
}

export async function readDeskAccountId(serverBaseUrl: string, token: string): Promise<string> {
    try {
        const profile = await fetchJson<{ id?: unknown }>(`${serverBaseUrl}/v1/account/profile`, {
            headers: { Authorization: `Bearer ${token}` },
        });
        if (profile.status !== 200 || typeof profile.data?.id !== 'string' || !profile.data.id) {
            throw new Error('Invalid disposable profile');
        }
        return profile.data.id;
    } catch {
        throw new Error('Disposable account profile verification failed; sensitive details withheld');
    }
}

export async function assertRestoredDeskIdentity(
    page: Page,
    serverBaseUrl: string,
    expected: Readonly<{ accountId: string; secret: string }>,
): Promise<void> {
    try {
        const restored = await readDeskCredentials(page);
        if (!restored || restored.secret !== expected.secret) throw new Error('Recovery identity mismatch');
        const accountId = await readDeskAccountId(serverBaseUrl, restored.token);
        if (accountId !== expected.accountId) throw new Error('Account identity mismatch');
    } catch {
        throw new Error('Restored disposable account identity did not match; sensitive details withheld');
    }
}

/** UI-created disposable identity; signup and recovery both use production entry points. */
export async function createEncryptedDeskAccount(page: Page, uiBaseUrl: string, serverBaseUrl: string) {
    let step: EncryptedDeskSignupStep = 'UI';
    try {
        await gotoDomContentLoadedWithRetries(page, `${uiBaseUrl}/?happier_hmr=0`, 180_000);
        await waitForInitialAppUi({ page });
        const hero = page.getByTestId('brand-hero-get-started');
        if (await hero.isVisible()) await hero.click();
        const create = page.getByTestId('welcome-primary-start').or(page.getByTestId('welcome-create-account'));
        await expect(create.first()).toBeVisible({ timeout: 120_000 });
        await create.first().click();

        // Read only this disposable browser's credentials. Traces, snapshots and raw diagnostics
        // are disabled before navigation; never return credentials from an assertion callback.
        await expect.poll(async () => !!await readDeskCredentials(page), { timeout: 120_000, message: 'disposable keyed account signed in' }).toBe(true);
        const credentials = await readDeskCredentials(page);
        if (!credentials) throw new Error('Disposable keyed account credentials unavailable');
        step = 'encryption mode';
        const mode = await fetchJson<{ mode?: unknown }>(`${serverBaseUrl}/v1/account/encryption`, {
            headers: { Authorization: `Bearer ${credentials.token}` },
        });
        expect(mode.status, 'account encryption mode read').toBe(200);
        expect(mode.data.mode === 'e2ee', 'the UI-created account must actually use E2EE').toBe(true);
        step = 'profile';
        const accountId = await readDeskAccountId(serverBaseUrl, credentials.token);
        step = 'key derivation';
        const machineKey = deriveAccountMachineKeyFromRecoverySecret(Buffer.from(credentials.secret, 'base64url'));
        const contentPublicKey = tweetnacl.box.keyPair.fromSecretKey(machineKey).publicKey;
        let restored = false;
        return {
            token: credentials.token,
            encryption: { contentPublicKey },
            // The journey's context has never opened this account. Authenticate through the
            // production restore form only after the caller has seeded the relay. Do not copy
            // signup storage or a decrypted snapshot into that cold context.
            async openAuthenticatedPage(journeyPage: Page) {
                if (restored) {
                    await gotoDomContentLoadedWithRetries(journeyPage, `${uiBaseUrl}/desk`, 120_000);
                    await assertRestoredDeskIdentity(journeyPage, serverBaseUrl, { accountId, secret: credentials.secret });
                    return;
                }
                try {
                    await gotoDomContentLoadedWithRetries(journeyPage, `${uiBaseUrl}/restore/manual?happier_hmr=0`, 180_000);
                    const input = journeyPage.getByTestId('restore-manual-secret-input');
                    await expect(input).toBeVisible({ timeout: 120_000 });
                    if (await readDeskCredentials(journeyPage)) throw new Error('Journey context is not fresh');
                    await input.fill(credentials.secret);
                    const submit = journeyPage.getByTestId('restore-manual-submit');
                    await expect(submit).toBeEnabled();
                    await submit.click();
                    await expect(input).toHaveCount(0, { timeout: 120_000 });
                    await journeyPage.waitForURL(url => url.origin === new URL(uiBaseUrl).origin && (url.pathname === '/' || url.pathname === '/desk'), { timeout: 120_000 });
                    await assertRestoredDeskIdentity(journeyPage, serverBaseUrl, { accountId, secret: credentials.secret });
                    restored = true;
                } catch {
                    // Locator.fill call logs can contain the recovery secret. Never propagate them.
                    throw new Error('Disposable account restore failed; sensitive call details withheld');
                }
            },
        };
    } catch (error) {
        throw encryptedDeskSignupError(error, step);
    }
}
