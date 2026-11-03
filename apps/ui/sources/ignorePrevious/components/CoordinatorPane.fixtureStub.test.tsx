import * as React from 'react';
import { act } from 'react';
import { StyleSheet } from 'react-native';
import { DeskCreature } from '../creature/DeskCreature';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';
import { AppPaneProvider } from '@/components/appShell/panes/AppPaneProvider';
import { createSessionFixture } from '@/dev/testkit/fixtures/sessionFixtures';
import { storage } from '@/sync/domains/state/storage';

import { DeskFixtureRouteContext } from '../deskFixtureGate';
import { CoordinatorPane } from './CoordinatorPane';
import { TranscriptAppearanceContext } from '@/components/sessions/transcript/TranscriptAppearanceContext';
import { DeskSettingsScreen } from '../screens/DeskSettingsScreen';
import { deskPrefs } from '../deskPrefs';
import { DESK_FONT_STACK } from '../fonts/deskFont';
import { deskThemes } from '../palette';
import { MaskFace } from './MaskFace';
import { SessionView } from '@/components/sessions/shell/SessionView';
import { MMKV } from 'react-native-mmkv';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const viewport = vi.hoisted(() => ({ width: 1200 }));
vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock({ useWindowDimensions: () => ({ width: viewport.width, height: 900, scale: 1, fontScale: 1 }) });
});

// Navigation focus is supplied by the screen host; keep the desk clock/store real.
vi.mock('@react-navigation/native', () => ({ useIsFocused: () => true }));

vi.mock('@expo/vector-icons', async () => {
    const { createExpoVectorIconsMock } = await import('@/dev/testkit/mocks/icons');
    return createExpoVectorIconsMock();
});

vi.mock('@/modal', async () => {
    const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
    return createModalModuleMock().module;
});

// The fixture renders AgentInput with the complete production theme contract.
vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock();
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
            const appearance = React.useContext(TranscriptAppearanceContext);
            return <View testID={`session-view-${id}`} data-appearance={appearance}>
                <TextInput testID={`composer-${id}`} placeholder={resolved.placeholder} />
                {resolved.statusTrailingActions}
                {resolved.footerLeadingActions}
            </View>;
        },
    };
});

vi.mock('@/hooks/session/useHydrateSessionForRoute', async () => {
    const { deskScreenMocks } = await import('../testkit/deskScreenMocks');
    return deskScreenMocks.hydrateSessionForRoute();
});

function FixturePanes({ children }: React.PropsWithChildren) {
    return <AppPaneProvider>{children}</AppPaneProvider>;
}

describe('CoordinatorPane body', () => {
    const before = storage.getState();

    afterEach(() => {
        viewport.width = 1200;
        vi.unstubAllEnvs();
        storage.setState(before, true);
    });

    it.each([['mask', 128], ['terminal', 116]] as const)('renders one desk header at the %s height', async (style, height) => {
        deskPrefs.set('chatStyle', style);
        storage.getState().applySessions([createSessionFixture({ id: 'c1', active: true })]);
        storage.getState().applyMessagesLoaded('c1');
        storage.getState().applyReady();
        const screen = await renderScreen(<CoordinatorPane sessionId="c1" />);
        const header = screen.findByTestId('ip-coord-header');
        expect(header).not.toBeNull();
        expect(StyleSheet.flatten(header!.props.style).height).toBe(height);
        expect(screen.findByTestId('ip-coord-state')).not.toBeNull();
        expect(screen.getTextContent()).toContain('Shog');
        expect(screen.getTextContent()).toContain('coordinator');
        expect(header!.findAllByType(DeskCreature)).toHaveLength(1);
        expect(screen.tree.findByType(SessionView).props.showHeader).toBe(false);
    });

    it.each([
        ['mask', 1200, 1000, 128], ['terminal', 1200, 1000, 116],
        ['mask', 390, 390, 72], ['terminal', 390, 390, 72],
        ['mask', 320, 320, 72], ['terminal', 320, 320, 72],
    ] as const)('reveals the %s header creature at viewport %i and opens the full panel', async (style, viewportWidth, headerWidth, height) => {
        viewport.width = viewportWidth;
        deskPrefs.set('chatStyle', style);
        deskPrefs.set('creatureEnabled', true);
        storage.getState().applySessions([createSessionFixture({ id: 'c1', active: true, activeAt: Date.now() })]);
        storage.getState().applyMessagesLoaded('c1');
        storage.getState().applyReady();
        const screen = await renderScreen(<CoordinatorPane sessionId="c1" />);
        const header = screen.findByTestId('ip-coord-header')!;
        await act(async () => header.props.onLayout({ nativeEvent: { layout: { width: headerWidth } } }));
        const creature = header.findByType(DeskCreature);
        const mask = header.findByProps({ testID: 'ip-coord-mask' });
        // The engine's mask box is 0.8 times head width; a larger box reveals body around the foreground mask.
        const bodyWidth = Math.min(height * 0.25, headerWidth * 0.2) * creature.props.scale * 0.8;
        expect(bodyWidth).toBeGreaterThan(mask.props.size * 1.45);
        expect(creature.props.anchor.x * headerWidth).toBeCloseTo((viewportWidth <= 390 ? 10 + 4 : style === 'terminal' ? 12 + 22 : 16 + 22) + mask.props.size / 2);
        expect(StyleSheet.flatten(header.props.style).height).toBe(height);
        expect(screen.getTextContent()).toContain('Shog');
        expect(screen.findByTestId('ip-coord-state')).not.toBeNull();
        await screen.pressByTestIdAsync('ip-shog-open');
        expect(screen.tree.root.findAll(node => node.props.borderRadius === 0
            && node.findAllByProps({ testID: 'ip-shog' }).length > 0).length).toBeGreaterThan(0);
        const panelCreature = screen.findByTestId('ip-shog')!.findByType(DeskCreature);
        expect(panelCreature.props.anchor).toEqual({ x: 0.5, y: 0.5 });
        expect(panelCreature.props.scale).toBe(1.6);
        expect(creature.props.playback).toBe('paused');
        await screen.unmount();
    });

    it.each([['mask', 820, 72], ['mask', 821, 128], ['terminal', 820, 72], ['terminal', 821, 116]] as const)(
        'uses the desk phone boundary for %s at %i', async (style, width, height) => {
            viewport.width = width;
            deskPrefs.set('chatStyle', style);
            const screen = await renderScreen(<CoordinatorPane sessionId="c1" />);
            expect(StyleSheet.flatten(screen.findByTestId('ip-coord-header')!.props.style).height).toBe(height);
            await screen.unmount();
        },
    );

    it.each(['dracula', 'terminalPaper'] as const)('uses %s for header artwork and accessory', async palette => {
        deskPrefs.set('chatStyle', 'terminal');
        deskPrefs.set('terminalPalette', palette);
        deskPrefs.set('creatureEnabled', true);
        let accessoryColour = '';
        const screen = await renderScreen(<CoordinatorPane sessionId="c1" headerAccessory={colour => {
            accessoryColour = colour;
            return null;
        }} />);
        const header = screen.findByTestId('ip-coord-header')!;
        expect(header.findByType(DeskCreature).props.artTheme).toBe(palette === 'terminalPaper' ? 'light' : 'dark');
        expect(header.findByProps({ testID: 'ip-coord-mask' }).props.colours.bone).toBe(deskThemes[palette].maskrim);
        expect(header.findByProps({ testID: 'ip-coord-mask' }).props.colours.idleSignal).toBe(deskThemes[palette].idleSignal);
        expect(accessoryColour).toBe(deskThemes[palette].ink);
        await screen.unmount();
    });

    it('M13 keeps the header creature mounted and pauses it until the Shog panel closes', async () => {
        deskPrefs.set('creatureEnabled', true);
        storage.getState().applySessions([createSessionFixture({ id: 'coord', active: true, activeAt: Date.now(), thinking: true, thinkingAt: Date.now() })]);
        storage.getState().applyReady();
        const screen = await renderScreen(<CoordinatorPane sessionId="coord" />);
        const headerCreature = () => screen.findByTestId('ip-coord-header')!.findByType(DeskCreature);
        const mounted = headerCreature();
        expect(mounted.props.mode).toBe('working');
        expect(mounted.props.playback).not.toBe('paused');
        await screen.pressByTestIdAsync('ip-shog-open');
        expect(screen.findByTestId('ip-shog')).not.toBeNull();
        expect(headerCreature()).toBe(mounted);
        expect(headerCreature().props.playback).toBe('paused');
        expect(screen.tree.root.findAllByType(DeskCreature)).toHaveLength(2);
        expect(screen.findByTestId('ip-shog-open')!.props.accessibilityState).toEqual({ expanded: true });
        await screen.pressByTestIdAsync('ip-shog-done');
        expect(screen.findByTestId('ip-shog')).toBeNull();
        expect(headerCreature()).toBe(mounted);
        expect(headerCreature().props.playback).not.toBe('paused');
        expect(headerCreature().props.mode).toBe('working');
    });

    it('F4: hides count-dependent state until waits load while preserving session status', async () => {
        const now = Date.now();
        const session = createSessionFixture({ id: 'c1', active: true, activeAt: now });
        storage.getState().applySessions([session]);
        storage.setState({ isDataReady: false });
        const screen = await renderScreen(<CoordinatorPane sessionId="c1" />);
        const stateText = () => screen.findByTestId('ip-coord-state')?.props.children;
        const maskBulb = () => screen.findByTestId('ip-coord-header')!.findByProps({ testID: 'ip-coord-mask' }).props.bulb;
        expect(screen.findByTestId('ip-coord-state')).toBeNull();
        expect(maskBulb()).toBe('idle');
        await act(async () => storage.getState().applySessions([{ ...session, thinking: true, thinkingAt: now }]));
        expect(stateText()).toBe('Thinking');
        await act(async () => storage.getState().applySessions([{ ...session, active: false, activeAt: now + 1 }]));
        expect(stateText()).toBe('offline');
        await act(async () => storage.getState().applySessions([{ ...session, activeAt: now + 2, thinkingAt: now + 2 }]));
        expect(screen.findByTestId('ip-coord-state')).toBeNull();
        expect(maskBulb()).toBe('idle');
        await act(async () => storage.getState().applyReady());
        expect(screen.findByTestId('ip-coord-state')).toBeNull();
        expect(maskBulb()).toBe('idle');
        await act(async () => storage.getState().applyMessagesLoaded('c1'));
        expect(stateText()).toBe('Idle');
        expect(maskBulb()).toBe('rest');
        const worker = createSessionFixture({ id: 'waiting-worker', active: true, activeAt: now, agentState: { requests: {
            a: { tool: 'Bash', arguments: { command: 'echo ready' }, createdAt: now },
        } } });
        await act(async () => storage.getState().applySessions([worker]));
        expect(stateText()).toBe('Idle');
        expect(maskBulb()).toBe('rest');
        await act(async () => storage.getState().applySessions([{ ...session, activeAt: now + 3, thinking: true, thinkingAt: now + 3 }]));
        expect(stateText()).toBe('Thinking');
        await act(async () => storage.getState().applySessions([{ ...session, active: false, activeAt: now + 4, thinking: true, thinkingAt: now + 3 }]));
        expect(stateText()).toBe('offline');
        await act(async () => storage.getState().applySessions([{ ...session, activeAt: now + 5, thinkingAt: now + 5 }, { ...worker, agentState: null }]));
        expect(stateText()).toBe('Idle');
        expect(maskBulb()).toBe('rest');
    });

    it('C15/C16: settings update the coordinator appearance while a plain SessionView stays null', async () => {
        vi.stubEnv('EXPO_PUBLIC_IP_FIXTURES', '');
        const screen = await renderScreen(<><DeskSettingsScreen /><CoordinatorPane sessionId="c1" /><SessionView id="worker" /></>);
        const read = () => screen.findByTestId('session-view-c1')!.props['data-appearance'];
        expect(read().fontFamily).toBe(DESK_FONT_STACK);
        expect(read().agentLeading.type).toBe(MaskFace);
        expect(read().userBubbleStyle).toBeUndefined();
        expect(screen.findByTestId('session-view-worker')!.props['data-appearance']).toBeNull();
        await screen.pressByTestIdAsync('ip-chat-style-terminal');
        expect(deskPrefs.get('chatStyle')).toBe('terminal');
        expect(read().agentLeading).toBeUndefined();
        expect(read().agentContainerStyle.borderLeftColor).toBe(deskThemes.tokyo.bot);
        for (const palette of ['kanagawa', 'gruvbox', 'dracula', 'terminalPaper', 'tokyo'] as const) {
            await screen.pressByTestIdAsync(`ip-chat-palette-${palette}`);
            expect(deskPrefs.get('terminalPalette')).toBe(palette);
            expect(read().userBubbleStyle.backgroundColor).toBe(deskThemes[palette].panel);
            expect(read().markdownColors.text.primary).toBe(deskThemes[palette].ink);
            expect(read().toolContainerStyle.backgroundColor).toBeUndefined();
        }
        await screen.pressByTestIdAsync('ip-chat-style-mask');
        expect(read().agentLeading.type).toBe(MaskFace);
        expect(read().agentContainerStyle).toBeUndefined();
        expect(screen.findByTestId('session-view-worker')!.props['data-appearance']).toBeNull();
        await screen.unmount();
    });

    it('falls back to defaults for unknown stored chat choices', async () => {
        const stored = new MMKV();
        stored.set('ignorePrevious.chatStyle', 'garbage');
        stored.set('ignorePrevious.terminalPalette', 'garbage');
        stored.set('ignorePrevious.thinkingAndTools', 'garbage');
        const screen = await renderScreen(<CoordinatorPane sessionId="c1" />);
        expect(screen.findByTestId('session-view-c1')!.props['data-appearance'].agentLeading.type).toBe(MaskFace);
        expect(deskPrefs.get('chatStyle')).toBe('mask');
        await screen.unmount();
        stored.set('ignorePrevious.chatStyle', 'terminal');
        const terminal = await renderScreen(<CoordinatorPane sessionId="c1" />);
        expect(terminal.findByTestId('session-view-c1')!.props['data-appearance'].userBubbleStyle.backgroundColor).toBe(deskThemes.tokyo.panel);
        expect(deskPrefs.get('thinkingAndTools')).toBe('reply-link');
    });

    it('renders the default Terminal palette for an unknown stored palette', async () => {
        const stored = new MMKV();
        stored.set('ignorePrevious.chatStyle', 'terminal');
        stored.set('ignorePrevious.terminalPalette', 'garbage');
        const screen = await renderScreen(<CoordinatorPane sessionId="c1" />);
        expect(screen.findByTestId('session-view-c1')!.props['data-appearance'].userBubbleStyle.backgroundColor).toBe(deskThemes.tokyo.panel);
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

    it('M9 mounts local run settings only on the coordinator, including the fixture route', async () => {
        vi.stubEnv('EXPO_PUBLIC_IP_FIXTURES', '');
        const screen = await renderScreen(<><CoordinatorPane sessionId="c1" /><SessionView id="worker" /></>);
        expect(screen.findByTestId('session-view-c1')!.findAllByProps({ testID: 'ip-run-settings' }).length).toBeGreaterThan(0);
        expect(screen.findByTestId('session-view-worker')!.findAllByProps({ testID: 'ip-run-settings' })).toHaveLength(0);
        await screen.unmount();
        vi.stubEnv('EXPO_PUBLIC_IP_FIXTURES', '1');
        const fixture = await renderScreen(<DeskFixtureRouteContext.Provider value={true}><CoordinatorPane sessionId="c1" /></DeskFixtureRouteContext.Provider>, { wrapper: FixturePanes });
        await act(async () => { await import('../fixtures/CoordinatorBodyStub'); });
        expect(fixture.findByTestId('ip-run-settings')).not.toBeNull();
    });

    it('Finding 7 C9 places the context gauge in the composer and removes the header meter, including fixtures', async () => {
        vi.stubEnv('EXPO_PUBLIC_IP_AUTOCOMPACT_CLAUDE', '220000');
        const base = createSessionFixture({ id: 'c1' });
        storage.getState().applySessions([{ ...base, metadata: { ...base.metadata!, flavor: 'claude' }, latestUsage: {
            inputTokens: 0, outputTokens: 0, cacheCreation: 0, cacheRead: 0,
            contextSize: 95_500, contextSizeIsReported: true, contextWindowTokens: 1_000_000, timestamp: 1,
        } }]);
        vi.stubEnv('EXPO_PUBLIC_IP_FIXTURES', '');
        const screen = await renderScreen(<CoordinatorPane sessionId="c1" />);
        expect(screen.findByTestId('session-view-c1')!.findAllByProps({ testID: 'ip-context-gauge' }).length).toBeGreaterThan(0);
        // The header is the pane's first host child. Check visible meter text, not a retired testID.
        const header = screen.findByTestId('ip-coordinator-pane')!.children[0];
        if (typeof header === 'string') throw new Error('Expected the coordinator header');
        expect(header.findAll(node => typeof node.type === 'string' && node.children.some(child =>
            typeof child === 'string' && /%|before auto-compact|of the window/.test(child),
        ))).toHaveLength(0);
        const overrides = screen.tree.findByType(SessionView).props.composer;
        expect(overrides.providerUsageGauge).toBeNull();
        expect(overrides.hide.contextUsage).toBe(true);
        await screen.unmount();
        vi.stubEnv('EXPO_PUBLIC_IP_FIXTURES', '1');
        const fixture = await renderScreen(<DeskFixtureRouteContext.Provider value={true}><CoordinatorPane sessionId="c1" /></DeskFixtureRouteContext.Provider>, { wrapper: FixturePanes });
        await act(async () => { await import('../fixtures/CoordinatorBodyStub'); });
        expect(fixture.findByTestId('agent-input-status-trailing')!.findAllByProps({ testID: 'ip-context-gauge' }).length).toBeGreaterThan(0);
        expect(fixture.findByTestId('ip-fixture-coordinator-body')!.findAllByProps({ testID: 'ip-context-gauge' })).toHaveLength(0);
    });

    it.each([false, true])('Finding 6 omits the status node without a hint or report, loaded=%s', async (loaded) => {
        viewport.width = 390;
        vi.stubEnv('EXPO_PUBLIC_IP_FIXTURES', '');
        if (loaded) storage.getState().applySessions([createSessionFixture({ id: 'no-report', latestUsage: null })]);
        const screen = await renderScreen(<CoordinatorPane sessionId="no-report" />);
        expect(screen.tree.findByType(SessionView).props.composer.statusTrailingActions).toBeNull();
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
        expect(screen.findByTestId('ip-fresh-start')).toBeNull();
        expect(screen.findByTestId('ip-fresh-more')).toBeNull();
        viewport.width = 390;
        await screen.unmount();
        const phone = await renderScreen(<CoordinatorPane sessionId="c1" />);
        expect(phone.findByTestId('ip-fresh-more')).toBeNull();
        await phone.unmount();
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
            { wrapper: FixturePanes },
        );

        // The stub is a lazy import: it appears once the chunk has loaded.
        await vi.waitFor(async () => {
            await act(async () => {});
            expect(screen.findByTestId('ip-fixture-coordinator-body')).not.toBeNull();
        });
        expect(screen.findByTestId('session-view-c1')).toBeNull();
        expect(screen.findByTestId('ip-fresh-fixture')).not.toBeNull();
        await screen.unmount();
    });
});
