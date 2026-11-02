import * as React from 'react';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';
import { createSessionFixture } from '@/dev/testkit/fixtures/sessionFixtures';
import { storage } from '@/sync/domains/state/storage';

import { DeskFixtureRouteContext } from '../deskFixtureGate';
import { CoordinatorPane } from './CoordinatorPane';
import { SessionView } from '@/components/sessions/shell/SessionView';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const viewport = vi.hoisted(() => ({ width: 1200 }));
vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock({ useWindowDimensions: () => ({ width: viewport.width, height: 900, scale: 1, fontScale: 1 }) });
});

vi.mock('@expo/vector-icons', async () => {
    const { createExpoVectorIconsMock } = await import('@/dev/testkit/mocks/icons');
    return createExpoVectorIconsMock();
});

vi.mock('@/modal', async () => {
    const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
    return createModalModuleMock().module;
});

vi.mock('@/components/sessions/shell/SessionView', async () => {
    const { useSessionComposerOverrides } = await import('@/components/sessions/model/sessionComposerOverrides');
    const { TextInput, View } = await import('react-native');
    return {
        // Replace the transcript/socket surface, retaining the real composer override resolver.
        SessionView: ({ id, composer }: React.ComponentProps<typeof SessionView>) => {
            const resolved = useSessionComposerOverrides({
                isReadOnly: false, placeholder: 'Stock placeholder', extraActionChips: undefined,
                statusBadges: [], providerUsageGauge: undefined, onMicPress: undefined,
                isMicActive: undefined, onAbort: undefined, alwaysShowContextSize: false,
            }, composer);
            return <View testID={`session-view-${id}`}>
                <TextInput testID={`composer-${id}`} placeholder={resolved.placeholder} />
                {resolved.statusTrailingActions}
            </View>;
        },
    };
});

vi.mock('@/hooks/session/useHydrateSessionForRoute', async () => {
    const { deskScreenMocks } = await import('../testkit/deskScreenMocks');
    return deskScreenMocks.hydrateSessionForRoute();
});

describe('CoordinatorPane body', () => {
    const before = storage.getState();

    afterEach(() => {
        viewport.width = 1200;
        vi.unstubAllEnvs();
        storage.setState(before, true);
    });

    it('J1: only the coordinator gets Talk to Shog through the composer seam', async () => {
        vi.stubEnv('EXPO_PUBLIC_IP_FIXTURES', '');
        const screen = await renderScreen(<>
            <CoordinatorPane sessionId="c1" />
            <SessionView id="worker" />
        </>);
        expect(screen.findByTestId('composer-c1')?.props.placeholder).toBe('Talk to Shog');
        expect(screen.findByTestId('composer-worker')?.props.placeholder).toBe('Stock placeholder');
    });

    it('J1: the Enter hint appears once in a wide chat and disappears when the chat narrows', async () => {
        vi.stubEnv('EXPO_PUBLIC_IP_FIXTURES', '');
        const screen = await renderScreen(<CoordinatorPane sessionId="c1" />);
        const pane = screen.findByTestId('ip-coordinator-pane');
        expect(pane).not.toBeNull();
        await act(async () => pane!.props.onLayout({ nativeEvent: { layout: { width: 900 } } }));
        expect(screen.tree.findAll((node) => node.props.testID === 'ip-composer-enter-hint' && typeof node.type === 'string')).toHaveLength(1);
        await act(async () => pane!.props.onLayout({ nativeEvent: { layout: { width: 390 } } }));
        expect(screen.findByTestId('ip-composer-enter-hint')).toBeNull();
    });

    it('J1: a phone never shows the Enter hint, even before a stale wide-pane measurement updates', async () => {
        viewport.width = 390;
        vi.stubEnv('EXPO_PUBLIC_IP_FIXTURES', '');
        const screen = await renderScreen(<CoordinatorPane sessionId="c1" />);
        await act(async () => screen.findByTestId('ip-coordinator-pane')!.props.onLayout({ nativeEvent: { layout: { width: 900 } } }));
        expect(screen.findByTestId('ip-composer-enter-hint')).toBeNull();
    });

    it('hides the send hint when Enter-to-send is disabled in the real settings store', async () => {
        vi.stubEnv('EXPO_PUBLIC_IP_FIXTURES', '');
        storage.setState({ settings: { ...storage.getState().settings, agentInputEnterToSend: false } });
        const screen = await renderScreen(<CoordinatorPane sessionId="c1" />);
        await act(async () => screen.findByTestId('ip-coordinator-pane')!.props.onLayout({ nativeEvent: { layout: { width: 900 } } }));
        expect(screen.findByTestId('ip-composer-enter-hint')).toBeNull();
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
