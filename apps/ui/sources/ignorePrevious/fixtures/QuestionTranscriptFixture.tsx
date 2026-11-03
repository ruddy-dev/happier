import * as React from 'react';
import { View } from 'react-native';
import { MessageView } from '@/components/sessions/transcript/MessageView';
import { TranscriptAppearanceContext } from '@/components/sessions/transcript/TranscriptAppearanceContext';
import { AskUserQuestionView } from '@/components/tools/renderers/workflow/AskUserQuestionView';
import type { Message, ToolCall } from '@/sync/domains/messages/messageTypes';
import { useCoordinatorTranscriptAppearance } from '../useCoordinatorTranscriptAppearance';
import { FixtureToolGroup } from './FixtureToolGroup';
import { DeskContextDataContext } from '../model/questionContext';

// Synthetic display data only. The question has no session or live request, so it cannot send.
const messages: Message[] = [
    { kind: 'user-text', id: 'fixture-user', localId: null, createdAt: 1, text: 'Can you review ABC-12 and recommend a release?' },
    { kind: 'agent-text', id: 'fixture-agent', localId: null, createdAt: 2, text: 'The change is ready for review. I need one decision before continuing.' },
];
const question: ToolCall = {
    name: 'AskUserQuestion', state: 'running', createdAt: 3, startedAt: 3, completedAt: null, description: null,
    input: { questions: [{ header: 'ABC-12', question: 'Which release should we use?', multiSelect: false,
        options: [{ label: 'Stable', description: 'Use the current stable release.' }, { label: 'Preview', description: 'Try the preview release.' }],
        freeform: { placeholder: 'Or write another answer' } }] },
};

const fixtureContext = { items: new Map([['ABC-12', { id: 'ABC-12', title: 'Release review', status: 'active', pr: null }]]), projectNames: new Map([['ABC', 'Sample project']]) };

export function QuestionTranscriptFixture() {
    const appearance = useCoordinatorTranscriptAppearance();
    return <View testID="ip-question-fixture">
        <DeskContextDataContext.Provider value={fixtureContext}><TranscriptAppearanceContext.Provider value={appearance}>
            {messages.map((message, index) => <React.Fragment key={message.id}>
                {index === 1 ? <FixtureToolGroup /> : null}
                <MessageView message={message} sessionId="fixture-transcript" metadata={null} />
            </React.Fragment>)}
            <AskUserQuestionView tool={question} metadata={null} messages={[]} />
        </TranscriptAppearanceContext.Provider></DeskContextDataContext.Provider>
    </View>;
}
