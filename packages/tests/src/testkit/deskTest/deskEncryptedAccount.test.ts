import { createContext, runInContext } from 'node:vm';
import type { Page } from '@playwright/test';
import { afterEach, expect, it, vi } from 'vitest';

import { assertRestoredDeskIdentity } from './deskEncryptedAccount';

// Only disposable browser storage and HTTP are substituted. No auth/store domain mocks.
function page(credentials: unknown): Page {
    const realm = createContext({ localStorage: {
        length: credentials ? 1 : 0,
        key: () => 'auth_credentials__srv_disposable',
        getItem: () => JSON.stringify(credentials),
    } });
    return { evaluate: async (fn: () => unknown) => runInContext(`(${fn.toString()})()`, realm) } as unknown as Page;
}

afterEach(() => vi.unstubAllGlobals());

it('verifies the restored account through its fresh token rather than requiring the signup token', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
        const matches = new Headers(init?.headers).get('authorization') === 'Bearer fresh-disposable-token';
        return new Response(JSON.stringify({ id: matches ? 'same-disposable-account' : 'wrong-account' }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetch);
    await expect(assertRestoredDeskIdentity(
        page({ token: 'fresh-disposable-token', secret: 'disposable-key' }), 'http://127.0.0.1:23456',
        { accountId: 'same-disposable-account', secret: 'disposable-key' },
    )).resolves.toBeUndefined();
});

it.each(['account', 'key', 'missing', 'http', 'transport'] as const)('rejects a %s mismatch without disclosing identity or call details', async kind => {
    vi.stubGlobal('fetch', vi.fn<typeof globalThis.fetch>(async () => {
        if (kind === 'transport') throw new Error('Authorization: Bearer private-fixture-value');
        return new Response(JSON.stringify({ id: kind === 'account' ? 'other-account' : 'expected-account' }), { status: kind === 'http' ? 401 : 200 });
    }));
    const result = assertRestoredDeskIdentity(
        page(kind === 'missing' ? null : { token: 'restored-token', secret: kind === 'key' ? 'wrong-key' : 'expected-key' }),
        'http://127.0.0.1:23456', { accountId: 'expected-account', secret: 'expected-key' },
    );
    await expect(result).rejects.toThrow(/^Restored disposable account identity did not match; sensitive details withheld$/);
});
