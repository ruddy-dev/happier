import * as React from 'react';
import { View } from 'react-native';
import { buildTranscriptTurns } from '@/components/sessions/transcript/turnGrouping/buildTranscriptTurns';
import { buildTranscriptTurnUnits } from '@/components/sessions/transcript/turnGrouping/buildTranscriptTurnUnits';
import { ToolCallsGroupUnitHeaderRow } from '@/components/sessions/transcript/toolCalls/units/ToolCallsGroupUnitHeaderRow';
import { ToolCallsGroupUnitToolRow } from '@/components/sessions/transcript/toolCalls/units/ToolCallsGroupUnitToolRow';
import { ToolCallsGroupUnitFooterRow } from '@/components/sessions/transcript/toolCalls/units/ToolCallsGroupUnitFooterRow';
import type { Message, ToolCallMessage } from '@/sync/domains/messages/messageTypes';
import type { TranscriptInteraction } from '@/utils/sessions/deriveTranscriptInteraction';

const sessionId = 'fixture-transcript';
const interaction: TranscriptInteraction = { canSendMessages: false, canApprovePermissions: false, disableToolNavigation: true };
const tools: ToolCallMessage[] = ['release-notes.md', 'package.json'].map((path, index) => ({
    kind: 'tool-call', id: `fixture-read-${index}`, localId: null, createdAt: index + 2, children: [],
    tool: { id: `fixture-read-${index}`, name: 'Read', state: 'completed', input: { file_path: path },
        createdAt: index + 2, startedAt: index + 2, completedAt: index + 3, description: null },
}));
const user: Message = { kind: 'user-text', id: 'fixture-group-user', localId: null, createdAt: 1, text: '' };
const messages: Message[] = [user, ...tools];
const messagesById = Object.fromEntries(messages.map(message => [message.id, message]));
const turns = buildTranscriptTurns({ messageIdsOldestFirst: messages.map(message => message.id), messagesById,
    groupToolCalls: true, toolCallsGroupStrategy: 'all_tools_in_turn' });

// The surrounding fixture is already inside a ScrollView. Render the same production
// group units as the transcript list without nesting its virtualized viewport.
export function FixtureToolGroup() {
    const [expanded, setExpanded] = React.useState(false);
    const items = buildTranscriptTurnUnits({ items: turns.map(turn => ({ kind: 'turn', id: turn.id, turn })),
        getMessageById: id => messagesById[id] ?? null, isGroupExpanded: () => expanded, collapsedPreviewCount: 0 });
    return <View testID="ip-fixture-tool-group">{items.map(item => {
        if (item.kind === 'tool-group-header') return <ToolCallsGroupUnitHeaderRow key={item.id} sessionId={sessionId} groupId={item.groupId}
            metadata={null} interaction={interaction} toolMessages={item.toolMessageIds.flatMap(id => {
                const message = messagesById[id];
                return message?.kind === 'tool-call' ? [message] : [];
            })} expanded={item.expanded} setExpanded={setExpanded} />;
        if (item.kind === 'tool-group-tool') {
            const message = messagesById[item.toolMessageId];
            if (message?.kind !== 'tool-call') return null;
            return <ToolCallsGroupUnitToolRow key={item.id} sessionId={sessionId} groupId={item.groupId}
                metadata={null} interaction={interaction} message={message} expanded={item.expanded} />;
        }
        if (item.kind === 'tool-group-footer') return <ToolCallsGroupUnitFooterRow key={item.id} sessionId={sessionId}
            groupId={item.groupId} metadata={null} interaction={interaction} />;
        return null;
    })}</View>;
}
