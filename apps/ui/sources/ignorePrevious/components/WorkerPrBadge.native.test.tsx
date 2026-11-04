import * as React from 'react';
import { Linking, Platform } from 'react-native';
import { afterEach, expect, it, vi } from 'vitest';

import { createSessionFixture, renderScreen, standardCleanup } from '@/dev/testkit';
import { storage } from '@/sync/domains/state/storage';
import * as externalUrls from '@/utils/url/openExternalUrl';
import { prSnapshot } from '../testkit/prSnapshot';
import { WorkerPrBadge } from './WorkerPrBadge';

vi.mock('@react-navigation/native', async () => {
    const { createReactNavigationNativeMock } = await import('@/dev/testkit/mocks/reactNavigation');
    return createReactNavigationNativeMock();
});
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => vi.restoreAllMocks());

const url = 'https://example.invalid/example/project/pull/42';
const cases = (['ios', 'android'] as const).flatMap((platform) => [
    { platform, snapshotUrl: url, allowed: true },
    { platform, snapshotUrl: 'ftp://example.invalid/example/project/pull/42', allowed: false },
]);

it.each(cases)('retains native Linking policy on $platform for $snapshotUrl', async ({ platform, snapshotUrl, allowed }) => {
    const previous = storage.getState();
    const previousOS = Platform.OS;
    Platform.OS = platform;
    const open = vi.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    const externalOpen = vi.spyOn(externalUrls, 'openExternalUrl');
    const snapshot = prSnapshot({ fetchedAt: Date.now() });
    snapshot.pullRequest = { ...snapshot.pullRequest!, url: snapshotUrl };
    try {
        storage.getState().applySessions([createSessionFixture({ id: 'badge-worker' })]);
        storage.getState().updateSessionProjectScmSnapshot('badge-worker', snapshot);
        const screen = await renderScreen(<WorkerPrBadge sessionId="badge-worker" />);
        const badge = screen.findByTestId('ip-worker-pr-badge-worker')!;
        expect(badge.props.accessibilityRole).toBe('link');
        expect(badge.props.accessibilityLabel).toContain('PR #42');
        expect(badge.props.href).toBeUndefined();
        await screen.pressByTestIdAsync('ip-worker-pr-badge-worker');
        expect(open.mock.calls).toEqual(allowed ? [[url]] : []);
        if (!allowed) expect(externalOpen).not.toHaveBeenCalled();
    } finally {
        standardCleanup();
        storage.setState(previous, true);
        Platform.OS = previousOS;
    }
});
