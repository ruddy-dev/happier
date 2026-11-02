import * as React from 'react';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';
import { createSessionFixture } from '@/dev/testkit/fixtures/sessionFixtures';
import { storage } from '@/sync/domains/state/storage';

import { CoordinatorPane } from './CoordinatorPane';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@expo/vector-icons', async () => {
    const { createExpoVectorIconsMock } = await import('@/dev/testkit/mocks/icons');
    return createExpoVectorIconsMock();
});

vi.mock('@/modal', async () => {
    const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
    return createModalModuleMock().module;
});

vi.mock('@/components/sessions/shell/SessionView', async () => {
    const { deskScreenMocks } = await import('../testkit/deskScreenMocks');
    return deskScreenMocks.sessionView();
});

vi.mock('@/hooks/session/useHydrateSessionForRoute', async () => {
    const { deskScreenMocks } = await import('../testkit/deskScreenMocks');
    return deskScreenMocks.hydrateSessionForRoute();
});

describe('CoordinatorPane body', () => {
    const before = storage.getState();

    afterEach(() => {
        vi.unstubAllEnvs();
        storage.setState(before, true);
    });

    it('is Happier\'s session view in a normal build', async () => {
        vi.stubEnv('EXPO_PUBLIC_IP_FIXTURES', '');
        storage.getState().applySessions([createSessionFixture({ id: 'c1', active: true })]);

        const screen = await renderScreen(<CoordinatorPane sessionId="c1" />);

        expect(screen.findByTestId('session-view-c1')).not.toBeNull();
        expect(screen.findByTestId('ip-fixture-coordinator-body')).toBeNull();
        await screen.unmount();
    });

    it('is the fixture stub, not the session view, in a fixture build', async () => {
        vi.stubEnv('EXPO_PUBLIC_IP_FIXTURES', '1');
        storage.getState().applySessions([createSessionFixture({ id: 'c1', active: true })]);

        const screen = await renderScreen(<CoordinatorPane sessionId="c1" />);

        // The stub is a lazy import: it appears once the chunk has loaded.
        await vi.waitFor(async () => {
            await act(async () => {});
            expect(screen.findByTestId('ip-fixture-coordinator-body')).not.toBeNull();
        });
        expect(screen.findByTestId('session-view-c1')).toBeNull();
        await screen.unmount();
    });
});
