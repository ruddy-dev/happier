import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
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
        expect(screen.getTextContent()).toContain('Question for you');
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
    expect(screen.findByTestId('ask-user-question.option:0:0')?.props.disabled).toBe(true);
});

it.each(['AskUserQuestion', 'ask_user_question'])('reaches the question card through the %s transcript tool row', async (name) => {
    const { MessageView } = await import('@/components/sessions/transcript/MessageView');
    const { storage } = await import('@/sync/domains/state/storage');
    const settings = storage.getState().settings;
    storage.setState({ settings: { ...settings, toolViewDetailLevelDefault: 'full' } });
    try {
        const message = { kind: 'tool-call' as const, id: 'fixture-tool', localId: null, createdAt: 1, children: [], tool: { ...tool, name } };
        const row = <MessageView message={message} sessionId="fixture" metadata={null} />;
        const screen = await renderScreen(<TranscriptAppearanceContext.Provider value={{ fontFamily: 'Desk' }}>{row}</TranscriptAppearanceContext.Provider>);
        expect(screen.findByTestId('ip-question-card')).not.toBeNull();
        await screen.update(row);
        expect(screen.findByTestId('ip-question-card')).toBeNull();
    } finally {
        storage.setState({ settings });
    }
});
