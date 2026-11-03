import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { makeToolCall, makeToolViewProps, renderScreen } from '@/dev/testkit';
import { TranscriptAppearanceContext } from '@/components/sessions/transcript/TranscriptAppearanceContext';
import { AskUserQuestionView } from '@/components/tools/renderers/workflow/AskUserQuestionView';
import { DeskContextDataContext, resolveQuestionContext } from './model/questionContext';

vi.mock('@/components/sessions/terminal/openAttachedSessionTerminal', () => ({ useOpenAttachedSessionTerminal: () => ({ available: false, unavailableReason: 'missing_session', open: vi.fn() }) }));

const data = { items: new Map([['ATR-85', { id: 'ATR-85', title: 'Terminal transcript', status: 'active', pr: null }]]), projectNames: new Map([['ATR', 'Happier']]) };

describe('question context', () => {
    it('requires one explicit known issue mention and a known project', () => {
        expect(resolveQuestionContext(['Review ATR-85?'], null)).toBeNull();
        expect(resolveQuestionContext(['Review ATR-85?'], { ...data, items: new Map() })).toBeNull();
        // Cached status is not a live status claim; a closed cached item is still a mention.
        expect(resolveQuestionContext(['ATR-85'], { ...data, items: new Map([['ATR-85', { ...data.items.get('ATR-85')!, status: 'done' }]]) })?.issue).toBe('ATR-85');
        expect(resolveQuestionContext(['Review ATR-85?'], data)).toEqual({ issue: 'ATR-85', project: 'Happier' });
        for (const text of ['No issue here', 'ATR-86', 'ATR-85 and XYZ-3', 'ATR-85.5']) {
            expect(resolveQuestionContext([text], data)).toBeNull();
        }
        expect(resolveQuestionContext(['ATR-85', 'atr-85'], data)?.issue).toBe('ATR-85');
    });
    it('labels cached context as a mention and isolates ordinary Happier', async () => {
        const tool = makeToolCall({ name: 'AskUserQuestion', state: 'running', input: { questions: [{ header: 'ATR-85', question: 'Which option?', multiSelect: false, options: [] }] } });
        const question = <AskUserQuestionView {...makeToolViewProps(tool)} />;
        const screen = await renderScreen(<DeskContextDataContext.Provider value={data}><TranscriptAppearanceContext.Provider value={{ fontFamily: 'Desk' }}>{question}</TranscriptAppearanceContext.Provider></DeskContextDataContext.Provider>);
        expect(screen.findByTestId('ip-question-context')).not.toBeNull();
        expect(screen.getTextContent()).toContain('Mentions');
        expect(screen.getTextContent()).toContain('Happier');
        expect(screen.getTextContent()).toContain('ATR-85');
        await screen.update(<DeskContextDataContext.Provider value={data}>{question}</DeskContextDataContext.Provider>);
        expect(screen.findByTestId('ip-question-context')).toBeNull();
    });
});
