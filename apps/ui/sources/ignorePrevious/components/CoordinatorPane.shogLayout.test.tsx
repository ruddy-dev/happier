import * as React from 'react';
import { act } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { LayoutChangeEvent } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { renderScreen } from '@/dev/testkit';
import { createSessionFixture } from '@/dev/testkit/fixtures/sessionFixtures';
import { storage } from '@/sync/domains/state/storage';
import { darkTheme, lightTheme } from '@/theme';
import { CoordinatorPane } from './CoordinatorPane';
import { ShogView } from './ShogView';
import { deskPrefs } from '../deskPrefs';
import { AuthProvider } from '@/auth/context/AuthContext';
import { AppPaneProvider } from '@/components/appShell/panes/AppPaneProvider';

const viewport = vi.hoisted(() => ({ width: 390, height: 844 }));
vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock({ useWindowDimensions: () => ({ ...viewport, scale: 1, fontScale: 1 }) });
});
vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock();
});
vi.mock('react-native-safe-area-context', async () => {
    const { createSafeAreaContextMock } = await import('@/dev/testkit/mocks/nativeEnvironment');
    return createSafeAreaContextMock({ keyboard: { isVisible: false, height: 0 }, safeArea: { top: 0, right: 0, bottom: 0, left: 0 } });
});
vi.mock('@react-navigation/native', async () => {
    const { createReactNavigationNativeMock } = await import('@/dev/testkit/mocks/reactNavigation');
    return createReactNavigationNativeMock();
});
vi.mock('@expo/vector-icons', async () => {
    const { createExpoVectorIconsMock } = await import('@/dev/testkit/mocks/icons');
    return createExpoVectorIconsMock();
});
vi.mock('@/modal', async () => {
    const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
    return createModalModuleMock().module;
});
vi.mock('@/sync/sync', async () => {
    const { installSyncStub } = await import('@/dev/testkit/mocks/sync');
    const stub = installSyncStub()();
    // Real SessionView also reads the pending-message network boundary on mount.
    return { ...stub, sync: { ...stub.sync, fetchPendingMessages: async () => {} } };
});
// Match Metro's web resolution; both the shell and keyboard scaffold remain real.
vi.mock('@/components/sessions/transcript/AgentContentView', async () =>
    vi.importActual('@/components/sessions/transcript/AgentContentView.web'));
vi.mock('@/components/sessions/keyboardAvoidance/ComposerKeyboardScaffold', async () =>
    vi.importActual('@/components/sessions/keyboardAvoidance/ComposerKeyboardScaffold.web'));

let previous: ReturnType<typeof storage.getState>;
beforeEach(() => {
    previous = storage.getState();
    viewport.width = 390;
    storage.getState().applySessions([createSessionFixture({ id: 'coord', active: true, encryptionMode: 'plain' })]);
    storage.getState().applyReady();
    Object.assign(useUnistyles().theme, darkTheme);
});
afterEach(() => {
    act(() => {
        storage.setState(previous, true);
        deskPrefs.set('chatStyle', 'mask');
        deskPrefs.set('terminalPalette', 'tokyo');
    });
    Object.assign(useUnistyles().theme, lightTheme);
});

async function measureTranscript(screen: Awaited<ReturnType<typeof renderScreen>>, height: number) {
    // RN onLayout is the system boundary. The browser's flex layout supplies the space above
    // agent-content-input-footer, which includes the empty-draft shortcut row and all controls.
    const event = { nativeEvent: { layout: { x: 0, y: 0, width: viewport.width, height } } } satisfies Pick<LayoutChangeEvent, 'nativeEvent'>;
    await act(async () => screen.findHostByTestId('agent-content-scroll-region')!.props.onLayout?.(event));
}

it.each([
    ['terminal', 'tokyo', 394], ['terminal', 'terminalPaper', 394], ['mask', 'tokyo', 410.609375],
] as const)('fits expanded %s/%s above the measured phone composer, including empty shortcuts', async (style, palette, available) => {
    deskPrefs.set('chatStyle', style);
    deskPrefs.set('terminalPalette', palette);
    const screen = await renderScreen(<AuthProvider initialCredentials={null}><AppPaneProvider>
        <CoordinatorPane sessionId="coord" />
    </AppPaneProvider></AuthProvider>);
    expect(screen.findHostByTestId('ip-phone-shortcuts')).not.toBeNull();
    await measureTranscript(screen, available);
    await screen.pressByTestIdAsync('ip-shog-open');
    expect(screen.findHostByTestId('ip-phone-shortcuts')).not.toBeNull();
    const panel = () => screen.tree.findByType(ShogView);
    expect(panel().props.height, 'panel must end before the complete composer footer').toBeLessThanOrEqual(available);
    expect(panel().props.height).toBe(available);
    // Composer growth must reflow the already-open panel without remounting its controls/art.
    const mounted = panel();
    await measureTranscript(screen, available - 44);
    expect(panel()).toBe(mounted);
    expect(panel().props.height).toBe(available - 44);
    await measureTranscript(screen, 520);
    expect(panel().props.height).toBe(470);
    await screen.pressByTestIdAsync('ip-shog-done');
    expect(screen.findByTestId('ip-shog')).toBeNull();
    await screen.unmount();
});

it('retains the desktop panel height even when its transcript region changes', async () => {
    viewport.width = 1440;
    const screen = await renderScreen(<AuthProvider initialCredentials={null}><AppPaneProvider>
        <CoordinatorPane sessionId="coord" />
    </AppPaneProvider></AuthProvider>);
    await measureTranscript(screen, 394);
    await screen.pressByTestIdAsync('ip-shog-open');
    expect(screen.tree.findByType(ShogView).props.height).toBe(470);
    await screen.unmount();
});
