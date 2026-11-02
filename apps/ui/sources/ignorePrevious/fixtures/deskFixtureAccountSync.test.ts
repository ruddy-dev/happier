import { afterEach, describe, expect, it, vi } from 'vitest';

import { createSessionFixture } from '@/dev/testkit/fixtures/sessionFixtures';
import { encodeBase64 } from '@/encryption/base64';
import { storage } from '@/sync/domains/state/storage';
import { clearWarmCacheAccountScope, readPersistedSessionListWarmCacheEntries, resolveWarmCacheAccountScope } from '@/sync/domains/state/warmCachePersistence';
import { Encryption } from '@/sync/encryption/encryption';
import { sync } from '@/sync/sync';

import { applyDeskFixture } from './applyDeskFixture';

// The transport is the boundary. Session cleanup, account activation and cache saves stay real.
vi.mock('@/sync/domains/server/serverRuntime', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/sync/domains/server/serverRuntime')>();
    return { ...actual, getActiveServerSnapshot: () => ({ ...actual.getActiveServerSnapshot(), serverId: 'srv-fixture-auth', serverUrl: 'http://localhost:53288' }) };
});

describe('desk fixture account activation', () => {
    const before = storage.getState();
    let release: (() => void) | undefined;

    afterEach(() => {
        release?.();
        sync.disconnectServer();
        storage.setState(before, true);
        clearWarmCacheAccountScope();
        vi.useRealTimers();
        vi.unstubAllGlobals();
        vi.unstubAllEnvs();
    });

    it.each(['create', 'restore'] as const)('removes fixture sessions before %s activates account persistence', async (method) => {
        vi.stubEnv('EXPO_PUBLIC_IP_FIXTURES', '1');
        vi.useFakeTimers();
        vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
        const encryption = await Encryption.create(new Uint8Array(32).fill(9));
        release = applyDeskFixture();
        const accountId = `acct-fixture-${method}`;
        const token = `hdr.${encodeBase64(new TextEncoder().encode(JSON.stringify({ sub: accountId })), 'base64')}.sig`;
        const pending = sync[method]({ token, secret: encodeBase64(new Uint8Array(32).fill(7), 'base64url') }, encryption);
        // No React render or effect has run. An immediate sync-driven save must already be safe.
        expect(resolveWarmCacheAccountScope(null)).toBe(accountId);
        storage.getState().applySessions([createSessionFixture({ id: 'real-after-auth', active: true })]);
        storage.getState().deleteSession('absent-session');
        const persisted = Object.keys(readPersistedSessionListWarmCacheEntries('srv-fixture-auth', accountId) ?? {});
        expect(persisted).toContain('real-after-auth');
        expect(persisted.filter((id) => id.startsWith('fx-'))).toEqual([]);
        expect(Object.keys(storage.getState().sessions)).toEqual(['real-after-auth']);
        // Also covers an import resolving after account activation, before the route receives auth state.
        expect(() => applyDeskFixture()).toThrow();
        await vi.advanceTimersByTimeAsync(2_500);
        await pending;
    });
});
