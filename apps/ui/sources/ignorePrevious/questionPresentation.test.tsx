import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { standardCleanup } from '@/dev/testkit';
import { lightTheme } from '@/theme';
import { questionPaletteChecks } from './testkit/questionPaletteChecks';

vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock();
});
afterEach(standardCleanup);
questionPaletteChecks(lightTheme, 'tokyo');
import { makeToolCall, makeToolViewProps, renderScreen } from '@/dev/testkit';
import { TranscriptAppearanceContext } from '@/components/sessions/transcript/TranscriptAppearanceContext';
import { AskUserQuestionView } from '@/components/tools/renderers/workflow/AskUserQuestionView';

vi.mock('@/components/sessions/terminal/openAttachedSessionTerminal', () => ({
    useOpenAttachedSessionTerminal: () => ({ available: false, unavailableReason: 'missing_session', open: vi.fn() }),
}));

const tool = makeToolCall({ name: 'AskUserQuestion', state: 'running', input: { questions: [{
    header: 'Release', question: 'Which release?', multiSelect: false,
    options: [{ label: 'Stable', description: 'Use the stable release' }, { label: 'Preview', description: 'Try the preview' }],
    freeform: { placeholder: 'Another answer' },
}] } });

describe('desk question presentation', () => {
    it('frames the real question and preserves choices and typed input only within desk appearance', async () => {
        const question = <AskUserQuestionView {...makeToolViewProps(tool, { sessionId: 'fixture' })} />;
        const screen = await renderScreen(question);
        expect(screen.findByTestId('ip-question-card')).toBeNull();
        await screen.update(<TranscriptAppearanceContext.Provider value={{ fontFamily: 'Desk' }}>{question}</TranscriptAppearanceContext.Provider>);
        expect(screen.findByTestId('ip-question-card')).not.toBeNull();
        expect(screen.getTextContent()).not.toContain('Question for you');
        expect(screen.getTextContent()).toContain('Stable');
        expect(screen.getTextContent()).toContain('Preview');
        expect(screen.findByTestId('ask-user-question.freeform:0')).not.toBeNull();
    });
});

it('renders an offline transcript fixture with an inert real question', async () => {
    const { QuestionTranscriptFixture } = await import('./fixtures/QuestionTranscriptFixture');
    const screen = await renderScreen(<QuestionTranscriptFixture />);
    expect(screen.findByTestId('ip-question-fixture')).not.toBeNull();
    expect(screen.findByTestId('ip-question-card')).not.toBeNull();
    expect(screen.getTextContent()).toContain('Stable');
    expect(screen.findByTestId('ask-user-question.submit')).toBeNull();
    expect(screen.getTextContent()).not.toContain('Question for you');
    expect(screen.findByTestId('ask-user-question.option:0:0')?.props.disabled).toBe(true);
    await screen.pressByTestIdAsync('ask-user-question.option:0:0');
    act(() => screen.changeTextByTestId('ask-user-question.freeform:0', 'Inert preview'));
    expect(screen.findByTestId('ask-user-question.freeform:0')!.props.value).toBe('');
    expect(screen.findByTestId('ask-user-question.option:0:0')!.props.accessibilityState.selected).toBe(false);
});

it.each(['AskUserQuestion', 'ask_user_question'])('reaches the question card through the %s transcript tool row', async (name) => {
    const { MessageView } = await import('@/components/sessions/transcript/MessageView');
    const { storage } = await import('@/sync/domains/state/storage');
    const settings = storage.getState().settings;
    act(() => storage.setState({ settings: { ...settings, toolViewDetailLevelDefault: 'full' } }));
    try {
        const message = { kind: 'tool-call' as const, id: 'fixture-tool', localId: null, createdAt: 1, children: [], tool: { ...tool, name } };
        const row = <MessageView message={message} sessionId="fixture" metadata={null} />;
        const screen = await renderScreen(<TranscriptAppearanceContext.Provider value={{ fontFamily: 'Desk' }}>{row}</TranscriptAppearanceContext.Provider>);
        expect(screen.findByTestId('ip-question-card')).not.toBeNull();
        await screen.update(row);
        expect(screen.findByTestId('ip-question-card')).toBeNull();
    } finally {
        act(() => storage.setState({ settings }));
    }
});

it.each(['missing', 'mismatched', 'readOnly', 'public'] as const)('does not ask a %s observer to answer', async (reason) => {
    const { storage } = await import('@/sync/domains/state/storage');
    const { createSessionFixture } = await import('@/dev/testkit');
    const sessions = storage.getState().sessions;
    const request = { tool: 'AskUserQuestion', kind: 'user_action' as const, arguments: {}, createdAt: 1 };
    act(() => storage.setState({ sessions: { ...sessions, observer: createSessionFixture({ id: 'observer', agentState: {
        requests: reason === 'missing' ? {} : { [reason === 'mismatched' ? 'other' : 'question']: request },
    } }) } }));
    try {
        const question = <AskUserQuestionView {...makeToolViewProps({ ...tool, id: 'question' }, {
            sessionId: 'observer',
            interaction: { canSendMessages: false, canApprovePermissions: reason === 'missing' || reason === 'mismatched',
                ...((reason === 'readOnly' || reason === 'public') ? { permissionDisabledReason: reason } : {}) },
        })} />;
        const screen = await renderScreen(<TranscriptAppearanceContext.Provider value={{ fontFamily: 'Desk' }}>{question}</TranscriptAppearanceContext.Provider>);
        expect(screen.findByTestId('ip-question-card')).not.toBeNull();
        expect(screen.getTextContent()).not.toContain('Question for you');
        expect(screen.getTextContent()).toContain('Which release?');
        expect(screen.findByTestId('ask-user-question.submit')).toBeNull();
        expect(screen.findByTestId('ask-user-question.option:0:0')!.props.disabled).toBe(true);
        expect(screen.findByTestId('ask-user-question.freeform:0')!.props.editable).toBe(false);
        await screen.pressByTestIdAsync('ask-user-question.option:0:0');
        act(() => screen.changeTextByTestId('ask-user-question.freeform:0', 'Cannot send'));
        expect(screen.findByTestId('ask-user-question.option:0:0')!.props.accessibilityState.selected).toBe(false);
        expect(screen.findByTestId('ask-user-question.freeform:0')!.props.value).toBe('');
    } finally {
        act(() => storage.setState({ sessions }));
    }
});
