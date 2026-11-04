import * as React from 'react';
import { act } from 'react-test-renderer';
import { Platform } from 'react-native';
import { MMKV } from 'react-native-mmkv';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppPaneProvider } from '@/components/appShell/panes/AppPaneProvider';
import { renderScreen, standardCleanup } from '@/dev/testkit';
import { readReactNativeMmkvStubEntries } from '@/dev/testkit/mocks/mmkv';
import { storage } from '@/sync/domains/state/storage';
import { deskPrefs, setCoordinatorOverride } from '../deskPrefs';
import { robotPresets } from '../palette';

const state = vi.hoisted(() => ({
    pathname: '/desk/settings',
    width: 1440,
    dark: true,
    navigate: vi.fn(),
}));

vi.mock('expo-router', async () => {
    const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
    return createExpoRouterMock({ pathname: () => state.pathname, router: { navigate: state.navigate } }).module;
});
vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock({ useWindowDimensions: () => ({ width: state.width, height: 800, scale: 1, fontScale: 1 }) });
});
vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    const boundary = await createUnistylesMock();
    return {
        ...boundary,
        useUnistyles: () => {
            const { theme, rt } = boundary.useUnistyles();
            return { theme: { ...theme, dark: state.dark }, rt };
        },
    };
});
vi.mock('@expo/vector-icons', async () => {
    const { createExpoVectorIconsMock } = await import('@/dev/testkit/mocks/icons');
    return createExpoVectorIconsMock();
});
vi.mock('@react-navigation/native', async () => {
    const { createReactNavigationNativeMock } = await import('@/dev/testkit/mocks/reactNavigation');
    return createReactNavigationNativeMock();
});

function Panes({ children }: React.PropsWithChildren) {
    return <AppPaneProvider>{children}</AppPaneProvider>;
}

async function settingsPage() {
    const { default: SettingsPage } = await import('@/app/(app)/desk/settings');
    return <SettingsPage />;
}

describe('/desk/settings', () => {
    let previous: ReturnType<typeof storage.getState>;
    beforeEach(() => {
        previous = storage.getState();
        state.pathname = '/desk/settings';
        state.width = 1440;
        state.dark = true;
        state.navigate.mockClear();
    });
    afterEach(() => {
        standardCleanup();
        setCoordinatorOverride(null);
        act(() => storage.setState(previous, true));
    });

    it('shows the About credit and fork notice, and Back navigates directly to /desk', async () => {
        const screen = await renderScreen(await settingsPage());
        expect(screen.getTextContent()).toContain('by Ignore Previous');
        expect(screen.getTextContent()).toContain('A fork of Happier');
        expect(screen.findAllByProps({ 'data-ip-font': 'desk' })).toHaveLength(1);
        await screen.pressByTestIdAsync('ip-settings-back');
        expect(state.navigate).toHaveBeenCalledWith('/desk');
    });

    describe('Voice section', () => {
        let settingsWrite: ReturnType<typeof vi.spyOn>;
        beforeEach(() => {
            settingsWrite = vi.spyOn(storage.getState(), 'applySettings');
        });
        afterEach(() => {
            expect(settingsWrite).not.toHaveBeenCalled();
            settingsWrite.mockRestore();
        });

        it('shows the browser engine and privacy warning without engine choices or storage writes', async () => {
            const settings = storage.getState().settings;
            const screen = await renderScreen(await settingsPage());
            expect(screen.getTextContent()).toContain("Dictation: Browser's own");
            expect(screen.getTextContent()).toContain('May send your audio to Google');
            expect(screen.getTextContent()).toContain('A speech server that keeps audio on this PC is planned.');
            expect(screen.getTextContent()).not.toContain('Local model on this PC');
            expect(readReactNativeMmkvStubEntries()).toEqual([]);
            expect(storage.getState().settings).toBe(settings);
        });

        it.each([null, '', 'ja-JP'])('reads Happier language %j, follows updates, and links to its owner', async language => {
            const settings = storage.getState().settings;
            storage.setState({ settings: { ...settings, voice: { ...settings.voice, assistantLanguage: language } } });
            const screen = await renderScreen(await settingsPage());
            expect(screen.findByTestId('ip-voice-language')?.props.children).toContain(language || 'Browser default');
            await act(async () => {
                const current = storage.getState().settings;
                storage.setState({ settings: { ...current, voice: { ...current.voice, assistantLanguage: 'fr-FR' } } });
            });
            expect(screen.findByTestId('ip-voice-language')?.props.children).toContain('fr-FR');
            await screen.pressByTestIdAsync('ip-voice-settings-link');
            expect(state.navigate).toHaveBeenCalledWith('/settings/voice');
            expect(readReactNativeMmkvStubEntries()).toEqual([]);
        });

        it('stores only a pressed hold Space choice and restores it on remount', async () => {
            const settings = storage.getState().settings;
            const screen = await renderScreen(await settingsPage());
            expect(screen.findByTestId('ip-voice-hold-space')?.props.accessibilityRole).toBe('switch');
            expect(screen.findByTestId('ip-voice-hold-space')?.props.accessibilityState).toEqual({ checked: true });
            await screen.pressByTestIdAsync('ip-voice-hold-space');
            expect(readReactNativeMmkvStubEntries()).toEqual([['ignorePrevious.deskHoldSpace', '0']]);
            await screen.unmount();
            const remounted = await renderScreen(await settingsPage());
            expect(remounted.findByTestId('ip-voice-hold-space')?.props.accessibilityState).toEqual({ checked: false });
            expect(readReactNativeMmkvStubEntries()).toEqual([['ignorePrevious.deskHoldSpace', '0']]);
            expect(storage.getState().settings).toBe(settings);
        });

        it.each(['ios', 'android'] as const)('keeps the switch on %s with a browser-only note', async os => {
            const previousPlatform = Platform.OS;
            Platform.OS = os;
            try {
                const screen = await renderScreen(await settingsPage());
                expect(screen.getTextContent()).toContain('Hold Space works in the browser only.');
                await screen.pressByTestIdAsync('ip-voice-hold-space');
                expect(readReactNativeMmkvStubEntries()).toEqual([['ignorePrevious.deskHoldSpace', '0']]);
                await screen.unmount();
            } finally {
                Platform.OS = previousPlatform;
            }
        });
    });

    it('saves named robot swatches and face choices and updates the preview', async () => {
        const screen = await renderScreen(await settingsPage());
        for (const robot of ['droid', 'ipb', 'prompt', 'loupe', 'lab']) {
            for (const [preset, name] of [['purple', 'Purple'], ['violet', 'Violet'], ['green', 'Green'], ['orange', 'Orange'], ['blue', 'Blue'], ['magenta', 'Magenta'], ['steel', 'Steel']]) {
                const button = screen.findByTestId(`ip-robot-${robot}-${preset}`)!;
                expect(button.props.accessibilityRole).toBe('radio');
                expect(button.props.accessibilityLabel).toBe(name);
            }
        }
        const swatch = screen.findByTestId('ip-robot-droid-steel')!;
        expect(swatch.props.accessibilityRole).toBe('radio');
        expect(swatch.props.accessibilityLabel).toBe('Steel');
        expect(swatch.props.accessibilityState).toEqual({ checked: false });
        await screen.pressByTestIdAsync('ip-robot-droid-steel');
        expect(screen.findByTestId('ip-robot-droid-steel')!.props.accessibilityState).toEqual({ checked: true });
        expect(readReactNativeMmkvStubEntries()).toContainEqual(['ignorePrevious.robotDroid', 'steel']);
        const preview = screen.findByTestId('ip-robot-preview-droid')!;
        expect(preview.findAll(node => node.props.fill === robotPresets.steel.body).length).toBeGreaterThan(0);
        await screen.pressByTestIdAsync('ip-faces-B');
        expect(screen.findByTestId('ip-faces-B')!.props.accessibilityState).toEqual({ checked: true });
        expect(screen.findByTestId('ip-robot-preview-droid')!.findAllByProps({ testID: 'ip-sprite-ascii' })).toHaveLength(1);
        await screen.pressByTestIdAsync('ip-no-worker-ipb');
        expect(screen.findByTestId('ip-no-worker-ipb')!.props.accessibilityState).toEqual({ checked: true });
        expect(readReactNativeMmkvStubEntries()).toContainEqual(['ignorePrevious.noWorkerRobot', 'ipb']);
        expect(readReactNativeMmkvStubEntries()).toContainEqual(['ignorePrevious.workerFaces', 'B']);
    });

    it('does not materialize defaults in storage on mount or remount', async () => {
        const screen = await renderScreen(await settingsPage());
        expect(readReactNativeMmkvStubEntries()).toEqual([]);
        await screen.unmount();
        await renderScreen(await settingsPage());
        expect(readReactNativeMmkvStubEntries()).toEqual([]);
    });

    it('R48: reopens independent sprite rows without erasing the Codex model default or deferred fields', async () => {
        const settings = storage.getState().settings;
        const persisted = new MMKV();
        persisted.set('ignorePrevious.thinkingAndTools', 'hidden');
        persisted.set('ignorePrevious.codexRobot', 'model');
        await act(async () => deskPrefs.set('chatStyle', 'terminal'));
        const screen = await renderScreen(await settingsPage());
        expect(screen.findByTestId('ip-robot-picker-unassigned')).not.toBeNull();
        expect(screen.findByTestId('ip-robot-picker-codex')).not.toBeNull();
        expect(screen.findByTestId('ip-codex-robot-model')?.props.accessibilityState).toEqual({ checked: true });
        for (const id of ['ip-no-worker-droid', 'ip-no-worker-ipb', 'ip-codex-robot-model', 'ip-codex-robot-prompt', 'ip-codex-robot-loupe', 'ip-codex-robot-lab']) {
            expect(screen.findByTestId(id)!.findAllByProps({ testID: 'ip-sprite-pixels' }).length).toBeGreaterThan(0);
        }
        await screen.pressByTestIdAsync('ip-no-worker-ipb');
        expect(screen.findByTestId('ip-codex-robot-model')!.props.accessibilityState).toEqual({ checked: true });
        expect(persisted.getString('ignorePrevious.codexRobot')).toBe('model');
        await screen.unmount();
        const reopened = await renderScreen(await settingsPage());
        expect(reopened.findByTestId('ip-no-worker-ipb')!.props.accessibilityState).toEqual({ checked: true });
        await reopened.pressByTestIdAsync('ip-codex-robot-lab');
        expect(reopened.findByTestId('ip-no-worker-ipb')!.props.accessibilityState).toEqual({ checked: true });
        expect(reopened.findByTestId('ip-robot-caption-codex')).not.toBeNull();
        expect(reopened.findByTestId('ip-robot-preview-codex')!.findAllByProps({ testID: 'ip-sprite-pixels' })).toHaveLength(1);
        expect(reopened.getTextContent()).toContain('[✓]');
        await reopened.unmount();
        const third = await renderScreen(await settingsPage());
        expect(third.findByTestId('ip-codex-robot-lab')!.props.accessibilityState).toEqual({ checked: true });
        await third.pressByTestIdAsync('ip-codex-robot-model');
        expect(persisted.getString('ignorePrevious.noWorkerRobot')).toBe('ipb');
        expect(persisted.getString('ignorePrevious.codexRobot')).toBe('model');
        expect(persisted.getString('ignorePrevious.thinkingAndTools')).toBe('hidden');
        expect(storage.getState().settings).toBe(settings);
    });

    it.each([
        ['droid', 'A round droid with one bright eye.'],
        ['ipb', 'A boxy companion with an antenna.'],
    ])('R56: explains the saved preview-only choice for %s in the real Settings picker', async (choice, description) => {
        state.width = 390;
        const screen = await renderScreen(await settingsPage());
        await screen.pressByTestIdAsync(`ip-no-worker-${choice}`);
        expect(screen.findByTestId(`ip-no-worker-${choice}`)!.props.accessibilityState).toEqual({ checked: true });
        const caption = screen.findByTestId('ip-robot-caption-unassigned')!;
        expect(caption.props.children).toBe(`${description} Preview only for now. Your choice is saved for future unassigned issues.`);
        expect(caption.props.numberOfLines).toBeUndefined();
        expect(caption.props.accessibilityElementsHidden).not.toBe(true);
        expect(caption.props.importantForAccessibility).not.toBe('no-hide-descendants');
        expect(screen.findByTestId('ip-codex-robot-model')!.props.accessibilityState).toEqual({ checked: true });
    });

    it('R48: hydrates unknown role choices as safe defaults without writing on mount', async () => {
        const persisted = new MMKV();
        persisted.set('ignorePrevious.noWorkerRobot', 'future');
        persisted.set('ignorePrevious.codexRobot', 'future');
        const before = readReactNativeMmkvStubEntries();
        const screen = await renderScreen(await settingsPage());
        expect(screen.findByTestId('ip-no-worker-droid')!.props.accessibilityState).toEqual({ checked: true });
        expect(screen.findByTestId('ip-codex-robot-model')?.props.accessibilityState).toEqual({ checked: true });
        expect(readReactNativeMmkvStubEntries()).toEqual(before);
    });

    it.each(['ios', 'android'] as const)('R48: preserves %s radio accessibility and independent press selection', async os => {
        const previousPlatform = Platform.OS;
        Platform.OS = os;
        try {
            const screen = await renderScreen(await settingsPage());
            const droid = screen.findByTestId('ip-no-worker-droid')!;
            expect(droid.props.accessibilityRole).toBe('radio');
            expect(droid.props.accessibilityState).toEqual({ checked: true });
            expect(droid.props['aria-checked']).toBeUndefined();
            expect(droid.props.onKeyDown).toBeUndefined();
            await screen.pressByTestIdAsync('ip-no-worker-ipb');
            expect(screen.findByTestId('ip-no-worker-ipb')!.props.accessibilityState).toEqual({ checked: true });
            expect(screen.findByTestId('ip-no-worker-droid')!.props.accessibilityState).toEqual({ checked: false });
            expect(screen.findByTestId('ip-codex-robot-model')!.props.accessibilityState).toEqual({ checked: true });
            await screen.pressByTestIdAsync('ip-codex-robot-lab');
            expect(screen.findByTestId('ip-codex-robot-lab')!.props.accessibilityState).toEqual({ checked: true });
            expect(screen.findByTestId('ip-no-worker-ipb')!.props.accessibilityState).toEqual({ checked: true });
        } finally {
            Platform.OS = previousPlatform;
        }
    });

    it('R48: selects each role with arrow, Home, End and Space keys at phone width', async () => {
        state.width = 390;
        const screen = await renderScreen(await settingsPage());
        const key = async (id: string, value: string) => {
            const event = { key: value, preventDefault: vi.fn(), stopPropagation: vi.fn() };
            const option = screen.findByTestId(id);
            expect(option?.props.onKeyDown).toBeTypeOf('function');
            await act(async () => option!.props.onKeyDown(event));
            expect(event.preventDefault).toHaveBeenCalled();
        };
        await key('ip-no-worker-droid', 'ArrowRight');
        expect(screen.findByTestId('ip-no-worker-ipb')!.props.accessibilityState).toEqual({ checked: true });
        await key('ip-codex-robot-model', 'End');
        expect(screen.findByTestId('ip-codex-robot-lab')!.props.accessibilityState).toEqual({ checked: true });
        await key('ip-codex-robot-lab', 'Home');
        expect(screen.findByTestId('ip-codex-robot-model')!.props.accessibilityState).toEqual({ checked: true });
        await key('ip-codex-robot-prompt', ' ');
        expect(screen.findByTestId('ip-codex-robot-prompt')!.props.accessibilityState).toEqual({ checked: true });
        expect(screen.findByTestId('ip-no-worker-ipb')!.props.accessibilityState).toEqual({ checked: true });
    });

    it.each(['ios', 'android'] as const)('preserves native checked states without web props on %s', async os => {
        const previousPlatform = Platform.OS;
        Platform.OS = os;
        try {
            const screen = await renderScreen(await settingsPage());
            for (const [id, before, after] of [
                ['ip-chat-style-terminal', false, true],
                ['ip-chat-palette-gruvbox', false, true],
                ['ip-faces-B', false, true],
                ['ip-robot-droid-steel', false, true],
                ['ip-settings-creature', true, false],
            ] as const) {
                expect(screen.findByTestId(id)!.props.accessibilityState).toEqual({ checked: before });
                expect(screen.findByTestId(id)!.props['aria-checked']).toBeUndefined();
                await screen.pressByTestIdAsync(id);
                expect(screen.findByTestId(id)!.props.accessibilityState).toEqual({ checked: after });
                expect(screen.findByTestId(id)!.props['aria-checked']).toBeUndefined();
            }
        } finally {
            Platform.OS = previousPlatform;
        }
    });

    it('J12: a settings choice survives desk layout/theme changes and a settings remount', async () => {
        const screen = await renderScreen(await settingsPage(), { wrapper: Panes });
        expect(screen.findByTestId('ip-settings-creature')?.props.accessibilityState).toEqual({ checked: true });
        await screen.pressByTestIdAsync('ip-settings-creature');
        expect(screen.findByTestId('ip-settings-creature')?.props.accessibilityState).toEqual({ checked: false });

        const { default: DeskPage } = await import('@/app/(app)/desk');
        state.pathname = '/desk';
        await screen.update(<DeskPage />);
        await screen.pressByTestIdAsync('ip-settings-open');
        expect(state.navigate).toHaveBeenCalledWith('/desk/settings');
        await screen.pressByTestIdAsync('ip-work-collapse');
        expect(screen.findByTestId('ip-work-rail')).not.toBeNull();
        state.width = 390;
        state.dark = false;
        await screen.update(<DeskPage />);
        await screen.pressByTestIdAsync('ip-tab-work');
        expect(screen.findByTestId('ip-work')).not.toBeNull();
        state.width = 1440;
        await screen.update(<DeskPage />);
        expect(screen.findByTestId('ip-work-rail')).not.toBeNull();
        await screen.unmount();

        state.pathname = '/desk/settings';
        const remounted = await renderScreen(await settingsPage());
        expect(remounted.findByTestId('ip-settings-creature')?.props.accessibilityState).toEqual({ checked: false });
    });
});
