import * as React from 'react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Text, View } from 'react-native';
import { useUnistyles, StyleSheet } from 'react-native-unistyles';

import { makeToolCall, renderScreen } from '@/dev/testkit';
import { createSessionFixture } from '@/dev/testkit/fixtures/sessionFixtures';
import { lightTheme, darkTheme } from '@/theme';
import { parseThemeColor, themeContrastRatioOverLayers } from '@/theme/themeContrastMath';
import { storage } from '@/sync/domains/state/storage';
import { AgentContentView } from '@/components/sessions/transcript/AgentContentView.web';
import { EmptyMessages } from '@/components/ui/empty/EmptyMessages';
import { TranscriptFirstPaintPlaceholder } from '@/components/sessions/transcript/TranscriptFirstPaintPlaceholder';
import { CoordinatorTranscriptAppearanceProvider } from '../useCoordinatorTranscriptAppearance';
import { deskPrefs } from '../deskPrefs';
import { deskThemes } from '../palette';
import { DESK_FONT_STACK } from '../fonts/deskFont';
import { CoordinatorPrompts } from './CoordinatorPrompts';
import { AuthProvider } from '@/auth/context/AuthContext';
import { AppPaneProvider } from '@/components/appShell/panes/AppPaneProvider';
import { WorkAppearance } from './WorkAppearance';
import { TranscriptAppearanceContext } from '@/components/sessions/transcript/TranscriptAppearanceContext';
import { ComposerKeyboardScaffold as NativeScaffold } from '@/components/sessions/keyboardAvoidance/ComposerKeyboardScaffold.native';
import { ToolTimelineRowHeader } from '@/components/tools/shell/views/timeline/ToolTimelineRowHeader';
import { SessionActionRail } from '@/components/sessions/panes/SessionActionRail';
import { Icon } from '@/components/ui/icons/Icon';
import { ToolTimelineRow } from '@/components/tools/shell/views/ToolTimelineRow';

vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock();
});
vi.mock('react-native-safe-area-context', async () => {
    const { createSafeAreaContextMock } = await import('@/dev/testkit/mocks/nativeEnvironment');
    return createSafeAreaContextMock({ keyboard: { isVisible: false, height: 0 }, safeArea: { top: 0, right: 0, bottom: 0, left: 0 } });
});
vi.mock('@expo/vector-icons', async () => {
    const { createExpoVectorIconsMock } = await import('@/dev/testkit/mocks/icons');
    return createExpoVectorIconsMock();
});
vi.mock('@react-navigation/native', async () => {
    const { createReactNavigationNativeMock } = await import('@/dev/testkit/mocks/reactNavigation');
    return createReactNavigationNativeMock();
});
vi.mock('@/modal', async () => {
    const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
    return createModalModuleMock().module;
});
vi.mock('@/sync/sync', async () => {
    const { installSyncStub } = await import('@/dev/testkit/mocks/sync');
    return installSyncStub()();
});
// Match Metro's web module resolution, keeping the scaffold implementation real.
vi.mock('@/components/sessions/keyboardAvoidance/ComposerKeyboardScaffold', async () =>
    vi.importActual('@/components/sessions/keyboardAvoidance/ComposerKeyboardScaffold.web'));

function NativeShell({ transparent = false }: { transparent?: boolean }) {
    const appearance = React.useContext(TranscriptAppearanceContext);
    return <NativeScaffold mode="session" testID="native-host" composerTestID="native-footer"
        surface={transparent ? 'transparent' : 'opaque'} surfaceColor={appearance?.shellColors?.background}
        composer={<View />}><View /></NativeScaffold>;
}

const session = createSessionFixture({ id: 'coordinator', metadata: {
    host: 'coordinator-host', path: '/workspace/coordinator', homeDir: '/workspace',
} });
const cases = [
    { label: 'Tokyo on light app', style: 'terminal', palette: 'tokyo', app: lightTheme, paint: deskThemes.tokyo },
    { label: 'Paper on dark app', style: 'terminal', palette: 'terminalPaper', app: darkTheme, paint: deskThemes.terminalPaper },
    // Slip's existing light/dark bridge follows the app; it has no independent palette preference.
    { label: 'Slip light', style: 'mask', palette: 'tokyo', app: lightTheme, paint: deskThemes.paper },
    { label: 'Slip dark', style: 'mask', palette: 'tokyo', app: darkTheme, paint: deskThemes.night },
] as const;

describe('coordinator conversation paint through the real shell', () => {
    let previous: ReturnType<typeof storage.getState>;
    beforeEach(() => { previous = storage.getState(); });
    afterEach(() => {
        act(() => {
            storage.setState(previous, true);
            deskPrefs.set('chatStyle', 'mask');
            deskPrefs.set('terminalPalette', 'tokyo');
        });
        Object.assign(useUnistyles().theme, lightTheme);
    });

    const metadata = <ToolTimelineRowHeader density="comfortable" icon={null} title="Release review"
        subtitle="coordinator" statusText="Waiting for your response"
        disclosure={{ behavior: 'persistent', state: 'expanded' }} />;

    it.each(cases)('$label: coordinator metadata uses readable desk ink and loaded typography', async ({ style, palette, app, paint }) => {
        Object.assign(useUnistyles().theme, app);
        deskPrefs.set('chatStyle', style);
        deskPrefs.set('terminalPalette', palette);
        const screen = await renderScreen(<CoordinatorTranscriptAppearanceProvider>{metadata}</CoordinatorTranscriptAppearanceProvider>);
        const labels = screen.findAll(node => typeof node.type === 'string' && String(node.type) === 'Text');
        expect(labels).toHaveLength(3);
        for (const [index, label] of labels.entries()) {
            const rendered = StyleSheet.flatten(label.props.style);
            expect(rendered.color).toBe(index === 0 ? paint.ink : paint.mute);
            expect(rendered.fontFamily).toBe(DESK_FONT_STACK);
            expect(themeContrastRatioOverLayers(parseThemeColor(rendered.color), [paint.panel])).toBeGreaterThanOrEqual(4.5);
        }
        expect(screen.tree.findByType(Icon).props.color).toBe(paint.mute);
    });

    it.each(cases)('$label: inactive and selected action-rail icons stay readable', async ({ style, palette, app, paint }) => {
        Object.assign(useUnistyles().theme, app);
        deskPrefs.set('chatStyle', style);
        deskPrefs.set('terminalPalette', palette);
        const screen = await renderScreen(<AuthProvider initialCredentials={null}><AppPaneProvider>
            <CoordinatorTranscriptAppearanceProvider><SessionActionRail sessionId="coordinator" scopeId="palette-test" /></CoordinatorTranscriptAppearanceProvider>
        </AppPaneProvider></AuthProvider>);
        const git = () => screen.findHostByTestId('session-action-rail:git')!;
        expect(git().findByType(Icon).props.color).toBe(paint.mute);
        expect(themeContrastRatioOverLayers(parseThemeColor(git().findByType(Icon).props.color), [paint.panel])).toBeGreaterThanOrEqual(3);
        await screen.pressByTestIdAsync('session-action-rail:git');
        expect(git().props.accessibilityState.selected).toBe(true);
        expect(git().findByType(Icon).props.color).toBe(paint.ink);
        const marker = git().findAll(node => typeof node.type === 'string' && String(node.type) === 'View' && StyleSheet.flatten(node.props.style)?.width === 2);
        expect(marker).toHaveLength(1);
        expect(StyleSheet.flatten(marker[0].props.style).backgroundColor).toBe(paint.ink);
    });

    it.each(cases.slice(0, 2))('$label: the question metadata icon uses the same desk ink', async ({ style, palette, app, paint }) => {
        Object.assign(useUnistyles().theme, app);
        deskPrefs.set('chatStyle', style);
        deskPrefs.set('terminalPalette', palette);
        const screen = await renderScreen(<AuthProvider initialCredentials={null}><AppPaneProvider>
            <CoordinatorTranscriptAppearanceProvider><ToolTimelineRow sessionId="coordinator" metadata={null}
                tool={makeToolCall({ name: 'AskUserQuestion', state: 'completed', input: { questions: [] } })} />
            </CoordinatorTranscriptAppearanceProvider>
        </AppPaneProvider></AuthProvider>);
        const header = screen.findHostByTestId('tool-timeline-row')!;
        const icons = header.findAllByType(Icon);
        expect(icons.length).toBeGreaterThan(0);
        for (const icon of icons) expect([paint.ink, paint.mute]).toContain(icon.props.color);
    });

    it.each([lightTheme, darkTheme])('metadata and action rail retain ordinary-session appearance without a provider', async app => {
        Object.assign(useUnistyles().theme, app);
        const screen = await renderScreen(<AuthProvider initialCredentials={null}><AppPaneProvider>
            {metadata}<SessionActionRail sessionId="worker" scopeId="ordinary-test" />
        </AppPaneProvider></AuthProvider>);
        const labels = screen.findAll(node => typeof node.type === 'string' && String(node.type) === 'Text' && node.children.some(child =>
            typeof child === 'string' && ['Release review', 'coordinator', ' · Waiting for your response'].includes(child)));
        expect(labels).toHaveLength(3);
        for (const [index, label] of labels.entries()) {
            const rendered = StyleSheet.flatten(label.props.style);
            expect(rendered.fontFamily).not.toBe(DESK_FONT_STACK);
            // This Unistyles boundary evaluates static styles once, using its initial light theme.
            expect(rendered.color).toBe(index === 0 ? lightTheme.colors.text.primary : lightTheme.colors.text.secondary);
        }
        const git = () => screen.findHostByTestId('session-action-rail:git')!;
        expect(git().findByType(Icon).props.color).toBe(app.colors.text.secondary);
        await screen.pressByTestIdAsync('session-action-rail:git');
        expect(git().findByType(Icon).props.color).toBe(app.colors.text.primary);
    });

    it.each(cases)('$label: empty and populated shells have no opaque app-theme islands', async ({ style, palette, app, paint }) => {
        Object.assign(useUnistyles().theme, app);
        deskPrefs.set('chatStyle', style);
        deskPrefs.set('terminalPalette', palette);
        const screen = await renderScreen(<WorkAppearance><CoordinatorTranscriptAppearanceProvider>
            <AgentContentView input={<View testID="composer" />} placeholder={<EmptyMessages session={session} />} />
        </CoordinatorTranscriptAppearanceProvider></WorkAppearance>);
        const host = screen.findHostByTestId('agent-content-keyboard-host');
        expect(StyleSheet.flatten(host!.props.style).backgroundColor).toBe(paint.panel);
        expect(StyleSheet.flatten(screen.findHostByTestId('agent-content-input-footer')!.props.style).backgroundColor).toBe(paint.panel);
        const paintedGrounds = () => screen.findAll((node) => typeof node.type === 'string' && !!StyleSheet.flatten(node.props.style)?.backgroundColor);
        // Include the host's reserved bottom-chrome ground, beyond the inner scaffold.
        for (const ground of paintedGrounds()) expect(StyleSheet.flatten(ground.props.style).backgroundColor).toBe(paint.panel);
        const empty = screen.findHostByTestId('session-empty-messages');
        const labels = empty!.findAll((node) => typeof node.type === 'string' && String(node.type) === 'Text');
        expect(labels.length).toBeGreaterThan(1);
        for (const label of labels) {
            const rendered = StyleSheet.flatten(label.props.style);
            expect([paint.ink, paint.mute]).toContain(rendered.color);
            expect(rendered.fontFamily).toBe(DESK_FONT_STACK);
            expect(themeContrastRatioOverLayers(parseThemeColor(rendered.color), [paint.panel])).toBeGreaterThanOrEqual(4.5);
        }
        // A populated timeline replaces the placeholder in this same real host.
        await act(async () => screen.tree.update(<WorkAppearance><CoordinatorTranscriptAppearanceProvider>
            <AgentContentView input={<View testID="composer" />} content={<Text>Existing transcript</Text>} />
        </CoordinatorTranscriptAppearanceProvider></WorkAppearance>));
        expect(screen.getTextContent()).toContain('Existing transcript');
        expect(StyleSheet.flatten(screen.findHostByTestId('agent-content-keyboard-host')!.props.style).backgroundColor).toBe(paint.panel);
        for (const ground of paintedGrounds()) expect(StyleSheet.flatten(ground.props.style).backgroundColor).toBe(paint.panel);
    });

    it.each(cases)('$label: desktop shortcuts use the desk paint and terminal shape', async ({ style, palette, app, paint }) => {
        Object.assign(useUnistyles().theme, app);
        deskPrefs.set('chatStyle', style);
        deskPrefs.set('terminalPalette', palette);
        const screen = await renderScreen(<WorkAppearance><CoordinatorPrompts coordinatorId="coordinator" /></WorkAppearance>);
        const chip = screen.findHostByTestId('ip-start-new');
        const rendered = StyleSheet.flatten(chip!.props.style);
        expect(rendered.backgroundColor).toBe(paint.panel2);
        expect(rendered.borderColor).toBe(paint.rule);
        expect(rendered.borderRadius).toBe(style === 'terminal' ? 0 : 10);
        const label = chip!.findAll((node) => typeof node.type === 'string' && String(node.type) === 'Text')[0];
        expect(StyleSheet.flatten(label.props.style).color).toBe(style === 'terminal' ? paint.mute : paint.ink);
        expect(StyleSheet.flatten(label.props.style).fontFamily).toBe(DESK_FONT_STACK);
        expect(themeContrastRatioOverLayers(parseThemeColor(StyleSheet.flatten(label.props.style).color), [rendered.backgroundColor])).toBeGreaterThanOrEqual(4.5);
        expect(screen.getTextContent().includes('[ ')).toBe(style === 'terminal');
    });

    it.each([lightTheme, darkTheme])('ordinary session shell keeps its app paint without an appearance provider', async (app) => {
        Object.assign(useUnistyles().theme, app);
        const screen = await renderScreen(<AgentContentView input={<View />} placeholder={<EmptyMessages session={session} />} />);
        expect(StyleSheet.flatten(screen.findHostByTestId('agent-content-keyboard-host')!.props.style).backgroundColor).toBe(app.colors.surface.base);
        expect(StyleSheet.flatten(screen.findHostByTestId('agent-content-input-footer')!.props.style).backgroundColor).toBe(app.colors.surface.base);
    });

    it.each(cases)('$label: the actual SessionView cold route uses the coordinator ground and loading ink', async ({ style, palette, app, paint }) => {
        Object.assign(useUnistyles().theme, app);
        deskPrefs.set('chatStyle', style);
        deskPrefs.set('terminalPalette', palette);
        act(() => storage.setState({ sessions: {}, isDataReady: false }));
        const { SessionView } = await import('@/components/sessions/shell/SessionView');
        const screen = await renderScreen(<AuthProvider initialCredentials={null}><AppPaneProvider>
            <WorkAppearance><CoordinatorTranscriptAppearanceProvider>
                <SessionView id="coordinator" showHeader={false} surfaceFocusedOverride routeAnchorOverride />
            </CoordinatorTranscriptAppearanceProvider></WorkAppearance>
        </AppPaneProvider></AuthProvider>);
        const loading = screen.findHostByTestId('session-route-loading');
        expect(loading).not.toBeNull();
        // The first painted ancestor is the route shell, before AgentContentView exists.
        let node = loading?.parent;
        while (node && !StyleSheet.flatten(node.props.style)?.backgroundColor) node = node.parent;
        expect(StyleSheet.flatten(node?.props.style)?.backgroundColor).toBe(paint.panel);
        const spinner = loading!.findByType((await import('@/components/ui/feedback/ActivitySpinner')).ActivitySpinner);
        expect(spinner.props.color).toBe(paint.mute);
    });

    it.each(cases)('$label: the native keyboard scaffold paints the same ground', async ({ style, palette, app, paint }) => {
        Object.assign(useUnistyles().theme, app);
        deskPrefs.set('chatStyle', style);
        deskPrefs.set('terminalPalette', palette);
        const screen = await renderScreen(<WorkAppearance><CoordinatorTranscriptAppearanceProvider>
            <NativeShell />
        </CoordinatorTranscriptAppearanceProvider></WorkAppearance>);
        expect(StyleSheet.flatten(screen.findHostByTestId('native-host')!.props.style).backgroundColor).toBe(paint.panel);
        expect(StyleSheet.flatten(screen.findHostByTestId('native-footer')!.props.style).backgroundColor).toBe(paint.panel);
        await act(async () => screen.tree.update(<WorkAppearance><CoordinatorTranscriptAppearanceProvider>
            <NativeShell transparent />
        </CoordinatorTranscriptAppearanceProvider></WorkAppearance>));
        expect(StyleSheet.flatten(screen.findHostByTestId('native-host')!.props.style).backgroundColor).toBeUndefined();
        expect(StyleSheet.flatten(screen.findHostByTestId('native-footer')!.props.style).backgroundColor).toBeUndefined();
    });

    it.each(cases)('$label: the timeline first-paint overlay cannot cover the shell with app paint', async ({ style, palette, app, paint }) => {
        Object.assign(useUnistyles().theme, app);
        deskPrefs.set('chatStyle', style);
        deskPrefs.set('terminalPalette', palette);
        const screen = await renderScreen(<WorkAppearance><CoordinatorTranscriptAppearanceProvider>
            <AgentContentView input={<View />} content={<TranscriptFirstPaintPlaceholder reducedMotion />} />
        </CoordinatorTranscriptAppearanceProvider></WorkAppearance>);
        const overlay = screen.findHostByTestId('transcript-first-paint-placeholder')!;
        expect(StyleSheet.flatten(overlay.props.style).backgroundColor).toBe(paint.panel);
        expect(overlay.props.pointerEvents).toBe('none');
        expect(overlay.props.accessibilityElementsHidden).toBe(true);
        if (style === 'terminal') {
            const painted = overlay.findAll((node) => typeof node.type === 'string' && !!StyleSheet.flatten(node.props.style)?.backgroundColor);
            for (const node of painted) {
                expect([paint.panel, paint.panel2, paint.rule]).toContain(StyleSheet.flatten(node.props.style).backgroundColor);
            }
        }
    });
});
