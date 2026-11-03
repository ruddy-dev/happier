import * as React from 'react';
import { act, type ReactTestInstance } from 'react-test-renderer';
import { StyleSheet } from 'react-native';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createSessionFixture, makeToolCall, makeToolViewProps, renderScreen, standardCleanup } from '@/dev/testkit';
import { AskUserQuestionView } from '@/components/tools/renderers/workflow/AskUserQuestionView';
import { storage } from '@/sync/domains/state/storage';
import type { Theme } from '@/theme';
import { parseThemeColor, themeContrastRatioOverLayers } from '@/theme/themeContrastMath';
import { CoordinatorTranscriptAppearanceProvider } from '../useCoordinatorTranscriptAppearance';
import { deskPrefs } from '../deskPrefs';
import { terminalPalettes, type TerminalPalette } from '../palette';

const tool = makeToolCall({ id: 'palette-question', name: 'AskUserQuestion', state: 'running', input: { questions: [{
    header: 'Release', question: 'Which release?', multiSelect: false,
    options: [{ label: 'Stable', description: 'Use the stable release' }, { label: 'Preview', description: 'Try the preview' }],
    freeform: { placeholder: 'Another answer', description: 'Explain your choice' },
}, {
    header: 'Checks', question: 'Which checks?', multiSelect: true,
    options: [{ label: 'Tests', description: 'Run tests' }],
}] } });

function contrast(ink: string, layers: readonly string[]) {
    return themeContrastRatioOverLayers(parseThemeColor(ink), layers);
}

function backgroundBehind(node: ReactTestInstance): string {
    for (let parent = node.parent; parent; parent = parent.parent) {
        if (typeof parent.type !== 'string') continue;
        const background = StyleSheet.flatten(parent.props.style)?.backgroundColor;
        if (background && background !== 'transparent') return background;
    }
    throw new Error('No rendered background for text');
}

function textNode(root: ReactTestInstance, text: string) {
    return root.findAll(node => typeof node.type === 'string' && node.children.includes(text))[0];
}

/** Exercises the actual question controls under each independently selected host theme. */
export function questionPaletteChecks(theme: Theme, palette: TerminalPalette) {
    const paint = terminalPalettes[palette];
    const originalPrefs = { style: deskPrefs.get('chatStyle'), palette: deskPrefs.get('terminalPalette') };
    const originalSessions = storage.getState().sessions;
    beforeEach(() => {
        deskPrefs.set('chatStyle', 'terminal');
        deskPrefs.set('terminalPalette', palette);
        storage.setState({ sessions: { ...originalSessions, 'palette-session': createSessionFixture({ id: 'palette-session', agentState: {
            requests: { 'palette-question': { tool: 'AskUserQuestion', kind: 'user_action', arguments: {}, createdAt: 1 } },
        } }) } });
    });
    afterEach(() => {
        standardCleanup();
        deskPrefs.set('chatStyle', originalPrefs.style);
        deskPrefs.set('terminalPalette', originalPrefs.palette);
        storage.setState({ sessions: originalSessions });
    });
    const question = () => <AskUserQuestionView {...makeToolViewProps(tool, { sessionId: 'palette-session' })} />;

    it(`renders readable question, choices, selection and typed response with ${palette} over ${theme.dark ? 'dark' : 'light'} Happier`, async () => {
        const screen = await renderScreen(<CoordinatorTranscriptAppearanceProvider>{question()}</CoordinatorTranscriptAppearanceProvider>);
        const card = StyleSheet.flatten(screen.findByTestId('ip-question-card')!.props.style);
        expect(card.backgroundColor).toBe(paint.panel);
        const checkText = (text: string, background: string) => {
            const color = StyleSheet.flatten(textNode(screen.root, text).props.style).color;
            expect(contrast(color, [background]), text).toBeGreaterThanOrEqual(4.5);
        };
        checkText('Which release?', card.backgroundColor);
        checkText('Release', backgroundBehind(textNode(screen.root, 'Release')));
        checkText('Question for you', paint.yel);
        for (const text of ['Stable', 'Use the stable release', 'Explain your choice']) checkText(text, paint.panel);
        const input = screen.findByTestId('ask-user-question.freeform:0')!;
        const inputPaint = StyleSheet.flatten(input.props.style);
        expect(contrast(inputPaint.color, [inputPaint.backgroundColor])).toBeGreaterThanOrEqual(4.5);
        expect(contrast(input.props.placeholderTextColor, [inputPaint.backgroundColor])).toBeGreaterThanOrEqual(4.5);
        expect(contrast(inputPaint.borderColor, [paint.panel])).toBeGreaterThanOrEqual(3);
        await screen.pressByTestIdAsync('ask-user-question.option:0:0');
        const selected = screen.findByTestId('ask-user-question.option:0:0')!;
        expect(selected.props.accessibilityState.selected).toBe(true);
        const selectedPaint = StyleSheet.flatten(selected.props.style);
        checkText('Stable', selectedPaint.backgroundColor);
        checkText('Use the stable release', selectedPaint.backgroundColor);
        expect(contrast(selectedPaint.borderColor, [selectedPaint.backgroundColor])).toBeGreaterThanOrEqual(3);
        await screen.pressByTestIdAsync('ask-user-question.option:1:0');
        const checkbox = screen.findByTestId('ask-user-question.option:1:0')!.findAll(node => node.props.name === 'check')[0];
        expect(checkbox).toBeDefined();
        expect(contrast(checkbox.props.color, [paint.hl])).toBeGreaterThanOrEqual(3);
        const submit = screen.findByTestId('ask-user-question.submit')!;
        expect(submit.props.disabled).toBe(false);
        checkText(submit.props.accessibilityLabel, StyleSheet.flatten(submit.props.style).backgroundColor);
        act(() => screen.changeTextByTestId('ask-user-question.freeform:0', 'Use the maintained release'));
        expect(screen.findByTestId('ask-user-question.freeform:0')!.props.value).toBe('Use the maintained release');
        expect(screen.findByTestId('ask-user-question.option:0:0')!.props.accessibilityState.selected).toBe(false);
        console.info(`question-palette ${palette}`, JSON.stringify({
            question: contrast(StyleSheet.flatten(textNode(screen.root, 'Which release?').props.style).color, [paint.panel]),
            choice: contrast(StyleSheet.flatten(textNode(screen.root, 'Stable').props.style).color, [paint.panel]),
            description: contrast(StyleSheet.flatten(textNode(screen.root, 'Use the stable release').props.style).color, [paint.panel]),
            response: contrast(inputPaint.color, [inputPaint.backgroundColor]),
            placeholder: contrast(input.props.placeholderTextColor, [inputPaint.backgroundColor]),
            selectedDescription: contrast(StyleSheet.flatten(textNode(screen.root, 'Use the stable release').props.style).color, [selectedPaint.backgroundColor]),
        }));
    });

    it('keeps awaiting presentation truthful when the matching request disappears and returns', async () => {
        const session = storage.getState().sessions['palette-session'];
        const screen = await renderScreen(<CoordinatorTranscriptAppearanceProvider>{question()}</CoordinatorTranscriptAppearanceProvider>);
        act(() => screen.changeTextByTestId('ask-user-question.freeform:0', 'Retained answer'));
        const input = screen.findByTestId('ask-user-question.freeform:0')!;
        act(() => storage.setState({ sessions: { ...storage.getState().sessions, 'palette-session': {
            ...session, agentState: { ...session.agentState, requests: {} },
        } } }));
        expect(screen.findByTestId('ip-question-card')).not.toBeNull();
        expect(screen.getTextContent()).not.toContain('Question for you');
        expect(textNode(screen.root, 'Question')).toBeDefined();
        expect(screen.findByTestId('ask-user-question.submit')).toBeNull();
        expect(screen.findByTestId('ask-user-question.freeform:0')).toBe(input);
        expect(input.props.editable).toBe(false);
        const option = screen.findByTestId('ask-user-question.option:0:0')!;
        expect(option.props.disabled).toBe(true);
        const opacity = StyleSheet.flatten(option.props.style).opacity ?? 1;
        expect(opacity).toBe(1);
        expect(contrast(StyleSheet.flatten(textNode(screen.root, 'Use the stable release').props.style).color, [paint.panel])).toBeGreaterThanOrEqual(4.5);
        await screen.pressByTestIdAsync('ask-user-question.option:0:0');
        act(() => screen.changeTextByTestId('ask-user-question.freeform:0', 'Unavailable edit'));
        expect(input.props.value).toBe('Retained answer');
        expect(option.props.accessibilityState.selected).toBe(false);
        act(() => storage.setState({ sessions: { ...storage.getState().sessions, 'palette-session': session } }));
        expect(screen.findByTestId('ask-user-question.freeform:0')).toBe(input);
        expect(input.props.editable).toBe(true);
        expect(screen.getTextContent()).toContain('Question for you');
        await screen.update(<CoordinatorTranscriptAppearanceProvider><AskUserQuestionView {...makeToolViewProps({
            ...tool, state: 'completed', result: { answers: { 'Which release?': 'Stable', 'Which checks?': 'Tests' } },
        }, { sessionId: 'palette-session' })} /></CoordinatorTranscriptAppearanceProvider>);
        expect(screen.getTextContent()).not.toContain('Question for you');
        expect(screen.findByTestId('ask-user-question.submit')).toBeNull();
        const answered = textNode(screen.root, 'Retained answer');
        expect(contrast(StyleSheet.flatten(answered.props.style).color, [paint.panel])).toBeGreaterThanOrEqual(4.5);
    });

    it('restores regular colors outside the scope and in Slip without remounting the input or losing its draft', async () => {
        const screen = await renderScreen(<CoordinatorTranscriptAppearanceProvider>{question()}</CoordinatorTranscriptAppearanceProvider>);
        act(() => screen.changeTextByTestId('ask-user-question.freeform:0', 'Keep this draft'));
        const input = screen.findByTestId('ask-user-question.freeform:0');
        act(() => deskPrefs.set('terminalPalette', palette === 'tokyo' ? 'terminalPaper' : 'tokyo'));
        expect(screen.findByTestId('ask-user-question.freeform:0')).toBe(input);
        expect(input!.props.value).toBe('Keep this draft');
        act(() => deskPrefs.set('chatStyle', 'mask'));
        await screen.update(<CoordinatorTranscriptAppearanceProvider>{question()}</CoordinatorTranscriptAppearanceProvider>);
        expect(screen.findByTestId('ask-user-question.freeform:0')).toBe(input);
        expect(input!.props.value).toBe('Keep this draft');
        expect(StyleSheet.flatten(textNode(screen.root, 'Which release?').props.style).color).toBe(theme.colors.text.primary);
        expect(StyleSheet.flatten(input!.props.style).backgroundColor).toBe(theme.colors.surface.base);
        const plain = await renderScreen(question());
        expect(plain.findByTestId('ip-question-card')).toBeNull();
        expect(StyleSheet.flatten(textNode(plain.root, 'Which release?').props.style).color).toBe(theme.colors.text.primary);
    });
}
