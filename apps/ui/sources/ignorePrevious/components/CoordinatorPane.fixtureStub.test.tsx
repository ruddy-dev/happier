import * as React from 'react';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';
import { createSessionFixture } from '@/dev/testkit/fixtures/sessionFixtures';
import { storage } from '@/sync/domains/state/storage';

import { DeskFixtureRouteContext } from '../deskFixtureGate';
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

    it('is Happier\'s session view for a real session even in a fixture build, outside the fixture route', async () => {
        vi.stubEnv('EXPO_PUBLIC_IP_FIXTURES', '1');
        storage.getState().applySessions([createSessionFixture({ id: 'c1', active: true })]);

        const screen = await renderScreen(<CoordinatorPane sessionId="c1" />);
        await act(async () => {});

        expect(screen.findByTestId('session-view-c1')).not.toBeNull();
        expect(screen.findByTestId('ip-fixture-coordinator-body')).toBeNull();
        await screen.unmount();
    });

    it.each(['', '0', 'true', ' 1'])('is Happier\'s session view inside the fixture route when the flag is %j', async (value) => {
        vi.stubEnv('EXPO_PUBLIC_IP_FIXTURES', value);
        storage.getState().applySessions([createSessionFixture({ id: 'c1', active: true })]);

        const screen = await renderScreen(
            <DeskFixtureRouteContext.Provider value={true}>
                <CoordinatorPane sessionId="c1" />
            </DeskFixtureRouteContext.Provider>,
        );
        await act(async () => {});

        expect(screen.findByTestId('session-view-c1')).not.toBeNull();
        expect(screen.findByTestId('ip-fixture-coordinator-body')).toBeNull();
        await screen.unmount();
    });

    it('is Happier\'s session view when the flag is unset', async () => {
        vi.stubEnv('EXPO_PUBLIC_IP_FIXTURES', undefined as unknown as string);
        storage.getState().applySessions([createSessionFixture({ id: 'c1', active: true })]);

        const screen = await renderScreen(
            <DeskFixtureRouteContext.Provider value={true}>
                <CoordinatorPane sessionId="c1" />
            </DeskFixtureRouteContext.Provider>,
        );
        await act(async () => {});

        expect(screen.findByTestId('session-view-c1')).not.toBeNull();
        await screen.unmount();
    });

    it('is the fixture stub, not the session view, inside the fixture route of a fixture build', async () => {
        vi.stubEnv('EXPO_PUBLIC_IP_FIXTURES', '1');
        storage.getState().applySessions([createSessionFixture({ id: 'c1', active: true })]);

        const screen = await renderScreen(
            <DeskFixtureRouteContext.Provider value={true}>
                <CoordinatorPane sessionId="c1" />
            </DeskFixtureRouteContext.Provider>,
        );

        // The stub is a lazy import: it appears once the chunk has loaded.
        await vi.waitFor(async () => {
            await act(async () => {});
            expect(screen.findByTestId('ip-fixture-coordinator-body')).not.toBeNull();
        });
        expect(screen.findByTestId('session-view-c1')).toBeNull();
        await screen.unmount();
    });
});
