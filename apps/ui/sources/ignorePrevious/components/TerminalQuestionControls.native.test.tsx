import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { installedNativePressable } from '../testkit/installedNativePressable';

vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock();
});
vi.mock('@/components/sessions/terminal/openAttachedSessionTerminal', () => ({
    useOpenAttachedSessionTerminal: () => ({ available: false, unavailableReason: 'missing_session', open: vi.fn() }),
}));
afterEach(() => vi.doUnmock('react-native'));

it.each(['ios', 'android'] as const)('binds Terminal choices through installed native Pressable on %s', async (os) => {
    vi.resetModules();
    const Pressable = installedNativePressable(os);
    vi.doMock('react-native', async () => {
        const { createReactNativeNativeMock } = await import('@/dev/testkit/mocks/reactNative');
        return createReactNativeNativeMock({ platformOS: os }, { Pressable });
    });
    const { renderScreen, standardCleanup, createSessionFixture, makeToolCall, makeToolViewProps } = await import('@/dev/testkit');
    const { StyleSheet } = await import('react-native');
    const { storage } = await import('@/sync/domains/state/storage');
    const { AskUserQuestionView } = await import('@/components/tools/renderers/workflow/AskUserQuestionView');
    const { CoordinatorTranscriptAppearanceProvider } = await import('../useCoordinatorTranscriptAppearance');
    const { deskPrefs } = await import('../deskPrefs');
    const { terminalPalettes } = await import('../palette');
    const original = storage.getState().sessions;
    const prefs = { style: deskPrefs.get('chatStyle'), palette: deskPrefs.get('terminalPalette') };
    const tool = makeToolCall({ id: 'native-question', name: 'AskUserQuestion', state: 'running', input: { questions: [{
        header: 'Checks', question: 'Which checks?', multiSelect: true,
        options: [{ label: 'Tests', description: 'Run tests' }, { label: 'Types', description: 'Check types' }],
        freeform: { multiline: true },
    }] } });
    try {
        deskPrefs.set('chatStyle', 'terminal');
        deskPrefs.set('terminalPalette', 'tokyo');
        const session = createSessionFixture({ id: 'native-session', agentState: { requests: {
            'native-question': { tool: 'AskUserQuestion', kind: 'user_action', arguments: tool.input, createdAt: 1 },
        } } });
        storage.setState({ sessions: { ...original, 'native-session': session } });
        const screen = await renderScreen(<CoordinatorTranscriptAppearanceProvider>
            <AskUserQuestionView {...makeToolViewProps(tool, { sessionId: 'native-session' })} />
        </CoordinatorTranscriptAppearanceProvider>);
        const option = screen.findHostByTestId('ask-user-question.option:0:0')!;
        // A string RN stub cannot satisfy this: the installed Pressable must reach its host.
        expect.soft(option.type).toBe('NativeView');
        const second = screen.findHostByTestId('ask-user-question.option:0:1')!;
        const input = screen.findHostByTestId('ask-user-question.freeform:0')!;
        const family = os === 'ios' ? 'Menlo' : 'monospace';
        expect.soft(StyleSheet.flatten(input.props.style).fontFamily).toBe(family);
        for (const node of screen.root.findAll(n => typeof n.type === 'string' &&
            (n.children.includes('Tests') || n.children.includes('Run tests') || n.props['aria-hidden'] === true))) {
            expect.soft(StyleSheet.flatten(node.props.style).fontFamily).toBe(family);
        }
        if (String(option.type) !== 'NativeView') return;
        expect(option.props.focusable).toBe(true);
        const event = { nativeEvent: {}, currentTarget: 1, target: 1, stopPropagation() {} };
        // These are the installed Pressability handlers on the native host, not renderer callbacks.
        act(() => option.props.onFocus(event));
        expect(StyleSheet.flatten(option.props.style).backgroundColor).toBe(terminalPalettes.tokyo.ink);
        act(() => option.props.onClick(event));
        act(() => second.props.onClick(event));
        expect(option.props.accessibilityState.selected).toBe(true);
        expect(second.props.accessibilityState.selected).toBe(true);
        act(() => option.props.onClick(event));
        expect(option.props.accessibilityState.selected).toBe(false);
        expect(second.props.accessibilityState.selected).toBe(true);
        act(() => option.props.onBlur(event));
        expect(StyleSheet.flatten(option.props.style).backgroundColor).not.toBe(terminalPalettes.tokyo.ink);
        act(() => input.props.onFocus(event));
        expect(StyleSheet.flatten(screen.findHostByTestId('ask-user-question.freeform-frame:0')!.props.style).borderWidth).toBe(2);
        act(() => screen.changeTextByTestId('ask-user-question.freeform:0', 'literal [answer]'));
        expect(input.props.value).toBe('literal [answer]');
        act(() => input.props.onBlur(event));
        expect(StyleSheet.flatten(screen.findHostByTestId('ask-user-question.freeform-frame:0')!.props.style).borderWidth).toBe(1);
        act(() => second.props.onClick(event));
        expect(second.props.accessibilityState.selected).toBe(true);
        act(() => second.props.onFocus(event));
        act(() => storage.setState({ sessions: { ...original, 'native-session': {
            ...session, agentState: { ...session.agentState, requests: {} },
        } } }));
        expect(second.props.accessibilityState.disabled).toBe(true);
        expect(second.props.focusable).toBe(false);
        expect(second.props.accessibilityState.selected).toBe(true);
        expect(StyleSheet.flatten(second.props.style).backgroundColor).toBe('transparent');
        act(() => second.props.onClick(event));
        expect(second.props.accessibilityState.selected).toBe(true);
        expect(input.props.editable).toBe(false);
        expect(input.props.value).toBe('');
        act(() => deskPrefs.set('chatStyle', 'mask'));
        expect(screen.findHostByTestId('ask-user-question.option:0:1')!.type).toBe('TouchableOpacity');
        expect(screen.findHostByTestId('ask-user-question.option:0:1')!.props.accessibilityState.selected).toBe(true);
        expect(screen.findHostByTestId('ask-user-question.freeform:0')).toBe(input);
    } finally {
        standardCleanup();
        storage.setState({ sessions: original });
        deskPrefs.set('chatStyle', prefs.style);
        deskPrefs.set('terminalPalette', prefs.palette);
    }
});
