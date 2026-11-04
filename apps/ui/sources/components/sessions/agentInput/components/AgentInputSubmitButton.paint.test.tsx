import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { renderScreen } from '@/dev/testkit';
import { lightTheme, darkTheme } from '@/theme';
import { CoordinatorComposer } from '@/ignorePrevious/components/CoordinatorComposer';
import { deskPrefs } from '@/ignorePrevious/deskPrefs';
import { terminalPalettes } from '@/ignorePrevious/palette';
import { getIconFamily, setIconFamily } from '@/components/ui/icons/iconFamily';
import { AgentInputSubmitButton } from './AgentInputSubmitButton';

const runtime = vi.hoisted(() => ({ platform: 'web' as 'web' | 'ios' }));
vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock({ Platform: { get OS() { return runtime.platform; } } });
});
vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock();
});
// Keep the real Icon and both drawing libraries. Only the native SVG drawing
// primitives use the testkit's host stand-ins, exposing the actual fill/stroke.
vi.unmock('@/components/ui/icons/Icon');
// Load the drawing source through Vite so its SVG imports reach the native
// boundary mock rather than Node's external ESM/CJS loader.
vi.mock('phosphor-react-native', async () => {
    // The package sources assume automatic JSX; this runner uses classic JSX.
    vi.stubGlobal('React', await import('react'));
    return vi.importActual('../../../../../node_modules/phosphor-react-native/src/index.tsx');
});
afterAll(() => vi.unstubAllGlobals());
beforeEach(() => vi.stubGlobal('React', React));

const previous = { style: deskPrefs.get('chatStyle'), palette: deskPrefs.get('terminalPalette'), family: getIconFamily() };
afterEach(async () => { await act(async () => {
    deskPrefs.set('chatStyle', previous.style); deskPrefs.set('terminalPalette', previous.palette);
    setIconFamily(previous.family);
    Object.assign(useUnistyles().theme, lightTheme);
}); });

it.each([
    ['web', 'tokyo', 'light'], ['web', 'terminalPaper', 'dark'],
    ['ios', 'tokyo', 'light'], ['ios', 'terminalPaper', 'dark'],
] as const)('pairs actual Send glyph and backing for %s %s over the opposing %s app theme', async (platform, palette, appTheme) => {
    runtime.platform = platform;
    Object.assign(useUnistyles().theme, appTheme === 'light' ? lightTheme : darkTheme);
    deskPrefs.set('chatStyle', 'terminal'); deskPrefs.set('terminalPalette', palette);
    const onSend = vi.fn();
    const onStop = vi.fn();
    const button = (hasSendableContent = true, disabled = false, canStop = false) => <AgentInputSubmitButton
        testID="submit" sessionId="coordinator" hasSendableContent={hasSendableContent} disabled={disabled}
        micActive={false} canStop={canStop} onSend={onSend} onStop={onStop} />;
    const screen = await renderScreen(<CoordinatorComposer>{button()}</CoordinatorComposer>);
    const paint = terminalPalettes[palette];
    const assertPaint = (family: 'hugeicons' | 'phosphor', expected: string) => {
        const submit = screen.findByTestId('submit')!;
        const paths = submit.findAll(node => typeof node.type === 'string' && String(node.type) === 'Path');
        expect(paths.length).toBeGreaterThan(0);
        // Resolve the drawing library's actual SVG paint, not the Pressable's
        // color: HugeIcons Paths inherit Svg currentColor; Phosphor uses G fill.
        if (family === 'hugeicons') {
            expect(paths.every(path => path.props.stroke === 'currentColor')).toBe(true);
            expect(submit.findByType('Svg' as never).props.color).toBe(expected);
        }
        else expect(submit.findByType('G' as never).props.fill).toBe(expected);
    };
    for (const family of ['hugeicons', 'phosphor'] as const) {
        await act(async () => setIconFamily(family));
        assertPaint(family, paint.yelink);
    }
    const submit = screen.findByTestId('submit')!;
    expect(StyleSheet.flatten(submit.props.style({ pressed: false })).backgroundColor).toBe(paint.yel);
    expect(submit.findAll(node => typeof node.type === 'string' && String(node.type) === 'LinearGradient')).toHaveLength(0);
    await screen.pressByTestIdAsync('submit'); expect(onSend).toHaveBeenCalledTimes(1);
    await screen.update(<CoordinatorComposer>{button(true, true)}</CoordinatorComposer>);
    expect(screen.findByTestId('submit')!.props.disabled).toBe(true);
    expect(StyleSheet.flatten(screen.findByTestId('submit')!.props.style({ pressed: false })).backgroundColor).toBe(useUnistyles().theme.colors.button.primary.background);
    assertPaint('phosphor', useUnistyles().theme.colors.button.primary.tint);
    await screen.update(<CoordinatorComposer>{button(false, false, true)}</CoordinatorComposer>);
    assertPaint('phosphor', paint.yelink);
    await screen.pressByTestIdAsync('submit'); expect(onStop).toHaveBeenCalledTimes(1);
    // Removing the desk scope restores the ordinary composer theme and gradient.
    await screen.update(button());
    const ordinary = screen.findByTestId('submit')!;
    expect(StyleSheet.flatten(ordinary.props.style({ pressed: false })).backgroundColor).toBe(useUnistyles().theme.colors.button.primary.background);
    expect(ordinary.findByType('LinearGradient' as never).props.colors).toEqual(useUnistyles().theme.colors.button.primary.gradient!.colors);
    assertPaint('phosphor', useUnistyles().theme.colors.button.primary.tint);
});
