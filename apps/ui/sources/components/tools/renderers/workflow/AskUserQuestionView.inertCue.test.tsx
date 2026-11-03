import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createSessionFixture, makeToolCall, makeToolViewProps, renderScreen, standardCleanup } from '@/dev/testkit';
import { CoordinatorTranscriptAppearanceProvider } from '@/ignorePrevious/useCoordinatorTranscriptAppearance';
import { deskPrefs } from '@/ignorePrevious/deskPrefs';
import { storage } from '@/sync/domains/state/storage';
import { t } from '@/text';
import { AskUserQuestionView } from './AskUserQuestionView';

vi.mock('@/components/sessions/terminal/openAttachedSessionTerminal', () => ({
    useOpenAttachedSessionTerminal: () => ({ available: false, unavailableReason: 'missing_session', open: vi.fn() }),
}));

const sessionId = 'inert-cue-session';
const requestId = 'inert-cue-question';
const session = createSessionFixture({
    id: sessionId,
    agentState: { requests: { [requestId]: { tool: 'AskUserQuestion', kind: 'user_action', arguments: {}, createdAt: 1 } } },
});
const tool = makeToolCall({
    id: requestId, name: 'AskUserQuestion', state: 'running',
    input: { questions: [{
        header: 'Release', question: 'Which release?', multiSelect: false,
        options: [{ label: 'Stable', description: 'Use the stable release' }],
        freeform: { placeholder: 'Another answer' },
    }] },
});
const optionId = 'ask-user-question.option:0:0';
const inputId = 'ask-user-question.freeform:0';
const cueId = 'ask-user-question.options-unavailable:0';

describe('Terminal question unavailable cue', () => {
    const originalSessions = storage.getState().sessions;
    const originalStyle = deskPrefs.get('chatStyle');

    beforeEach(() => {
        deskPrefs.set('chatStyle', 'terminal');
        storage.setState({ sessions: { ...originalSessions, [sessionId]: session } });
    });
    afterEach(() => {
        standardCleanup();
        deskPrefs.set('chatStyle', originalStyle);
        storage.setState({ sessions: originalSessions });
    });

    const question = (canApprovePermissions = true) => (
        <AskUserQuestionView {...makeToolViewProps(tool, {
            sessionId,
            interaction: { canSendMessages: true, canApprovePermissions, permissionDisabledReason: canApprovePermissions ? undefined : 'readOnly' },
        })} />
    );
    const removeRequest = () => storage.setState({ sessions: {
        ...storage.getState().sessions,
        [sessionId]: { ...session, agentState: { ...session.agentState, requests: {} } },
    } });

    it('shows unavailable choices to an owner with no matching request, then restores editing without losing the draft', async () => {
        const screen = await renderScreen(<CoordinatorTranscriptAppearanceProvider>{question()}</CoordinatorTranscriptAppearanceProvider>);
        expect(screen.findByTestId(cueId)).toBeNull();
        act(() => screen.changeTextByTestId(inputId, 'Retained answer'));
        const input = screen.findByTestId(inputId)!;
        act(removeRequest);

        expect(screen.findByTestId(cueId)).not.toBeNull();
        expect(screen.getTextContent()).toContain(t('common.unavailable'));
        expect(screen.findByTestId(optionId)!.props.disabled).toBe(true);
        expect(screen.findByTestId('ask-user-question.submit')).toBeNull();
        expect(input.props.editable).toBe(false);
        await screen.pressByTestIdAsync(optionId);
        act(() => screen.changeTextByTestId(inputId, 'Blocked edit'));
        expect(input.props.value).toBe('Retained answer');
        expect(screen.findByTestId(optionId)!.props.accessibilityState.selected).toBe(false);

        act(() => storage.setState({ sessions: { ...storage.getState().sessions, [sessionId]: session } }));
        expect(screen.findByTestId(cueId)).toBeNull();
        expect(screen.findByTestId(inputId)).toBe(input);
        expect(input.props.value).toBe('Retained answer');
        expect(input.props.editable).toBe(true);
        await screen.pressByTestIdAsync(optionId);
        expect(screen.findByTestId(optionId)!.props.accessibilityState.selected).toBe(true);
    });

    it('also shows the cue when permission makes a matching request read-only', async () => {
        const screen = await renderScreen(<CoordinatorTranscriptAppearanceProvider>{question(false)}</CoordinatorTranscriptAppearanceProvider>);
        expect(screen.findByTestId(cueId)).not.toBeNull();
        expect(screen.findByTestId(optionId)!.props.disabled).toBe(true);
    });

    it.each(['ordinary', 'slip'] as const)('keeps %s unavailable controls on their existing presentation', async (style) => {
        act(removeRequest);
        deskPrefs.set('chatStyle', 'mask');
        const screen = await renderScreen(style === 'slip'
            ? <CoordinatorTranscriptAppearanceProvider>{question()}</CoordinatorTranscriptAppearanceProvider>
            : question());
        expect(screen.findByTestId(cueId)).toBeNull();
        expect(screen.findByTestId(optionId)!.props.disabled).toBe(true);
    });
});
