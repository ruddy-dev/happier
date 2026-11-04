import * as React from 'react';
import { act, type ReactTestInstance } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import Yoga, { type Node as YogaNode } from 'yoga-layout';
import { StyleSheet, type ViewStyle } from 'react-native';
import { createSessionFixture, makeToolCall, makeToolViewProps, renderScreen, standardCleanup } from '@/dev/testkit';
import { storage } from '@/sync/domains/state/storage';
import { AskUserQuestionView } from '@/components/tools/renderers/workflow/AskUserQuestionView';
import { CoordinatorTranscriptAppearanceProvider } from '../useCoordinatorTranscriptAppearance';
import { deskPrefs } from '../deskPrefs';

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock();
});
vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock();
});
vi.mock('@/components/sessions/terminal/openAttachedSessionTerminal', () => ({
    useOpenAttachedSessionTerminal: () => ({ available: false, unavailableReason: 'missing_session', open: vi.fn() }),
}));
afterEach(standardCleanup);

function hostChildren(node: ReactTestInstance): ReactTestInstance[] {
    return node.children.flatMap(child => typeof child === 'string' ? [] :
        typeof child.type === 'string' ? [child] : hostChildren(child));
}
function textContent(node: ReactTestInstance): string {
    return node.children.map(child => typeof child === 'string' ? child : textContent(child)).join('');
}

// Real renderer styles and Yoga layout. Only OS glyph measurement is substituted
// with 8px monospace cells and 18px lines. This cannot certify device text shaping.
function layoutTree(host: ReactTestInstance, nodes: Map<ReactTestInstance, YogaNode>, cellWidth = 8): YogaNode {
    const node = Yoga.Node.create();
    nodes.set(host, node);
    const style: ViewStyle = StyleSheet.flatten(host.props.style) ?? {};
    if (style.flex != null) node.setFlex(style.flex);
    if (style.flexGrow != null) node.setFlexGrow(style.flexGrow);
    if (style.flexShrink != null) node.setFlexShrink(style.flexShrink);
    if (style.flexBasis != null) node.setFlexBasis(style.flexBasis as number | 'auto' | `${number}%`);
    if (style.flexDirection === 'row') node.setFlexDirection(Yoga.FLEX_DIRECTION_ROW);
    if (style.flexWrap === 'wrap') node.setFlexWrap(Yoga.WRAP_WRAP);
    if (style.alignItems === 'flex-start') node.setAlignItems(Yoga.ALIGN_FLEX_START);
    if (style.alignSelf === 'flex-start') node.setAlignSelf(Yoga.ALIGN_FLEX_START);
    for (const [value, apply] of [
        [style.minWidth, node.setMinWidth.bind(node)], [style.maxWidth, node.setMaxWidth.bind(node)],
        [style.minHeight, node.setMinHeight.bind(node)], [style.width, node.setWidth.bind(node)],
    ] as const) {
        if (typeof value === 'number' || typeof value === 'string' && /^\d+(\.\d+)?%$/.test(value)) apply(value as number | `${number}%`);
    }
    if (typeof style.gap === 'number') node.setGap(Yoga.GUTTER_ALL, style.gap);
    if (typeof style.paddingHorizontal === 'number') node.setPadding(Yoga.EDGE_HORIZONTAL, style.paddingHorizontal);
    if (typeof style.paddingVertical === 'number') node.setPadding(Yoga.EDGE_VERTICAL, style.paddingVertical);
    if (typeof style.borderWidth === 'number') node.setBorder(Yoga.EDGE_ALL, style.borderWidth);
    if (typeof style.marginTop === 'number') node.setMargin(Yoga.EDGE_TOP, style.marginTop);
    if (String(host.type) === 'Text') {
        const natural = Array.from(textContent(host)).length * cellWidth;
        node.setMeasureFunc((width, mode) => {
            const available = mode === Yoga.MEASURE_MODE_UNDEFINED ? natural : width;
            return { width: Math.min(natural, available), height: Math.max(1, Math.ceil(natural / Math.max(1, available))) * 18 };
        });
    } else {
        hostChildren(host).forEach((child, index) => node.insertChild(layoutTree(child, nodes, cellWidth), index));
    }
    return node;
}

it.each(['tokyo', 'terminalPaper', 'mask', 'ordinary'] as const)('computes bounded wrapping choices in %s', async (appearance) => {
    const sessions = storage.getState().sessions;
    const prefs = { style: deskPrefs.get('chatStyle'), palette: deskPrefs.get('terminalPalette') };
    const terminal = appearance === 'tokyo' || appearance === 'terminalPaper';
    const tool = makeToolCall({ id: 'layout-question', name: 'AskUserQuestion', state: 'running', input: { questions: [{
        header: 'Release', question: 'Which release?', multiSelect: false,
        options: [{ label: 'Last stable release (its pick)' }, { label: "Today's dev build" }], freeform: { multiline: true },
    }] } });
    try {
        act(() => {
            deskPrefs.set('chatStyle', terminal ? 'terminal' : 'mask');
            if (appearance === 'tokyo' || appearance === 'terminalPaper') deskPrefs.set('terminalPalette', appearance);
        });
        act(() => storage.setState({ sessions: { ...sessions, 'layout-session': createSessionFixture({ id: 'layout-session', agentState: { requests: {
            'layout-question': { tool: 'AskUserQuestion', kind: 'user_action', arguments: tool.input, createdAt: 1 },
        } } }) } }));
        const render = (current = tool) => {
            const question = <AskUserQuestionView {...makeToolViewProps(current, { sessionId: 'layout-session' })} />;
            return appearance === 'ordinary' ? question : <CoordinatorTranscriptAppearanceProvider>{question}</CoordinatorTranscriptAppearanceProvider>;
        };
        const screen = await renderScreen(render());
        const measure = (width: number, cellWidth = 8) => {
            const first = screen.findHostByTestId('ask-user-question.option:0:0')!;
            const second = screen.findHostByTestId('ask-user-question.option:0:1')!;
            let group = first.parent!;
            while (typeof group.type !== 'string') group = group.parent!;
            const nodes = new Map<ReactTestInstance, YogaNode>();
            const root = layoutTree(group, nodes, cellWidth);
            try {
                root.calculateLayout(width, undefined, Yoga.DIRECTION_LTR);
                const a = nodes.get(first)!.getComputedLayout();
                const b = nodes.get(second)!.getComputedLayout();
                for (const item of [a, b]) {
                    expect(item.height).toBeGreaterThanOrEqual(44);
                    expect(item.width).toBeGreaterThanOrEqual(44);
                    expect(item.left).toBeGreaterThanOrEqual(0);
                    expect(item.left + item.width).toBeLessThanOrEqual(width);
                }
                for (const [host, node] of nodes) {
                    const parent = node.getParent();
                    if (parent) {
                        expect(node.getComputedLeft()).toBeGreaterThanOrEqual(0);
                        expect(node.getComputedLeft() + node.getComputedWidth()).toBeLessThanOrEqual(parent.getComputedWidth());
                    }
                    if (String(host.type) === 'Text') expect(host.props.numberOfLines).toBeUndefined();
                }
                return [a, b];
            } finally { root.freeRecursive(); }
        };
        const [wideA, wideB] = measure(700);
        if (terminal) {
            expect.soft(wideA.top).toBe(wideB.top);
            expect.soft(wideA.width).toBeLessThan(350);
            expect.soft(wideB.width).toBeLessThan(wideA.width);
            const [phoneA, phoneB] = measure(294);
            expect(phoneB.top).toBeGreaterThanOrEqual(phoneA.top + phoneA.height);
            expect(phoneA.width).toBe(wideA.width);
            expect(phoneB.width).toBe(wideB.width);
            console.info(`question-layout ${appearance}`, JSON.stringify({ wide: [wideA, wideB], phone: [phoneA, phoneB] }));
            act(() => screen.findHostByTestId('ask-user-question.option:0:0')!.props.onFocus());
            const [focused] = measure(294);
            expect(focused.width).toBe(phoneA.width);
            expect(focused.height).toBe(phoneA.height);
        } else {
            expect(wideA.width).toBe(700);
            expect(wideB.width).toBe(700);
            expect(wideB.top).toBeGreaterThan(wideA.top);
        }
        const long = { ...tool, input: { questions: [{ header: 'Long', question: 'Which?', multiSelect: false, options: [
            { label: 'Donaudampfschifffahrtsgesellschaft'.repeat(4), description: '説明と詳細な選択肢'.repeat(12) },
            { label: '第二の選択肢', description: 'Long localized description with spaces '.repeat(5) },
        ] }] } };
        await screen.update(render(long));
        const [longA] = measure(214);
        expect(longA.height).toBeGreaterThan(44);
        const [scaledA] = measure(214, 16);
        expect(scaledA.height).toBeGreaterThan(longA.height);
        expect(screen.getTextContent()).toContain('Donaudampfschifffahrtsgesellschaft'.repeat(4));
        expect(screen.getTextContent()).toContain('説明と詳細な選択肢'.repeat(12));
    } finally {
        act(() => storage.setState({ sessions }));
        act(() => {
            deskPrefs.set('chatStyle', prefs.style);
            deskPrefs.set('terminalPalette', prefs.palette);
        });
    }
});
