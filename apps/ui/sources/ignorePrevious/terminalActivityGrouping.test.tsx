import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderHook, renderScreen, standardCleanup } from '@/dev/testkit';
import { createSessionFixture } from '@/dev/testkit/fixtures/sessionFixtures';
import { AppPaneProvider } from '@/components/appShell/panes/AppPaneProvider';
import { Icon } from '@/components/ui/icons/Icon';
import { TranscriptAppearanceContext } from '@/components/sessions/transcript/TranscriptAppearanceContext';
import { useChatListRootState } from '@/components/sessions/transcript/useChatListRootState';
import { useTranscriptItemsPipeline, useTranscriptToolAutoExpandEffect, type TranscriptItemsPipelineDeps } from '@/components/sessions/transcript/items/useTranscriptItemsPipeline';
import { ChainTranscriptList } from '@/components/sessions/transcript/ChainTranscriptList';
import type { ChatTranscriptListItem } from '@/components/sessions/transcript/chatListTypes';
import type { Message, ToolCallMessage } from '@/sync/domains/messages/messageTypes';
import { storage } from '@/sync/domains/state/storage';

import { deskPrefs } from './deskPrefs';
import { CoordinatorTranscriptAppearanceProvider } from './useCoordinatorTranscriptAppearance';

// The native list engines are the system boundary. All grouping, stores and rows stay real.
vi.mock('@legendapp/list/react-native', async () => {
    const { createCapturingLegendListMock } = await import('@/dev/testkit/mocks/legendList');
    return createCapturingLegendListMock().module;
});
vi.mock('@shopify/flash-list', async () => {
    const { createCapturingFlashListMock } = await import('@/dev/testkit/mocks/flashList');
    return createCapturingFlashListMock().module;
});

const session = createSessionFixture({ id: 'activity-chat', active: true });
const ref = <T,>(current: T) => ({ current });
function tool(id: string, state: ToolCallMessage['tool']['state'] = 'completed', permission?: ToolCallMessage['tool']['permission']): ToolCallMessage {
    return { kind: 'tool-call', id, localId: null, createdAt: 2, children: [], tool: {
        id, name: permission?.kind === 'user_action' ? 'AskUserQuestion' : 'Read',
        input: {}, state, createdAt: 2, startedAt: 2, completedAt: state === 'running' ? null : 3,
        description: null, permission,
    } };
}
const messages: Message[] = [
    { kind: 'user-text', id: 'user', localId: null, createdAt: 1, text: 'Inspect the project' },
    tool('read-one'),
    { kind: 'agent-text', id: 'progress', localId: null, createdAt: 3, text: 'Checking the next file' },
    tool('question', 'running', { id: 'question-request', kind: 'user_action', status: 'pending' }),
    { kind: 'agent-event', id: 'status', createdAt: 5, event: { type: 'message', message: 'Provider is reconnecting' } },
    tool('permission', 'running', { id: 'permission-request', kind: 'permission', status: 'pending' }),
    tool('read-two'),
    { kind: 'agent-text', id: 'answer', localId: null, createdAt: 8, text: 'Inspection finished' },
    { kind: 'user-text', id: 'next-user', localId: null, createdAt: 9, text: 'Continue' },
    tool('read-three'),
];

let previous: ReturnType<typeof storage.getState>;
beforeEach(() => {
    previous = storage.getState();
    deskPrefs.set('chatStyle', 'terminal');
    storage.getState().applySessions([session]);
    storage.getState().applyMessagesLoaded(session.id);
    storage.setState(state => ({ settings: { ...state.settings,
        transcriptGroupingMode: 'linear', transcriptGroupToolCalls: false,
        transcriptTurnToolCallsGroupStrategy: 'consecutive_tools',
        transcriptToolCallsCollapsedPreviewCount: 3, toolViewTimelineChromeMode: 'cards',
    } }));
    writeMessages(messages);
});
afterEach(() => {
    standardCleanup();
    storage.setState(previous, true);
    deskPrefs.set('chatStyle', 'mask');
});

function writeMessages(next: Message[]) {
    storage.setState(state => {
        const existing = state.sessionMessages[session.id]!;
        const messagesById = Object.fromEntries(next.map((message, index) => [message.id, { ...message, seq: index + 1 }]));
        return { sessionMessages: { ...state.sessionMessages, [session.id]: {
            ...existing, messagesById, messagesMap: messagesById,
            messageIdsOldestFirst: next.map(message => message.id), messagesVersion: existing.messagesVersion + 1,
            messageRevisionsById: Object.fromEntries(next.map(message => [message.id, existing.messagesVersion + 1])),
        } } };
    });
}
function Coordinator({ children }: React.PropsWithChildren) {
    return <CoordinatorTranscriptAppearanceProvider>{children}</CoordinatorTranscriptAppearanceProvider>;
}
function pipelineDeps(items: ChatTranscriptListItem[]): TranscriptItemsPipelineDeps {
    return {
        activeTargetWindowTargetRef: ref(null), activeThinkingMessageId: null,
        canonicalWindowedItemsRef: ref(items), committedMessagesCount: messages.length,
        entrySliceWindow: null, entrySliceWindowRef: ref(null), entrySliceWithheldCountRef: ref(0),
        expandedToolCallsAnchorMessageIds: new Set<string>(), forkMessageMetadataById: null,
        groupingMode: 'turns', isLoaded: true, items, itemsRef: ref(items), jumpToSeq: null,
        latestCommittedActivityKey: 'read-three', listDataRef: ref(items), listOrientation: 'standard',
        messagesById: {}, platformOS: 'web', preDecompositionItemsRef: ref(items), rendererKind: 'legendList',
        renderWindowIndexMapRef: ref(null), resolveActionDraftFieldOptions: () => [], resolveThinkingExpanded: () => false,
        rowFontScaleKey: 'default', rowWidthBucket: 'wide', sessionActive: true, sessionId: session.id,
        sessionThinking: false, setEntrySliceWindow: () => {}, targetWindowActiveRef: ref(false),
        transcriptNativeHotTailItemCount: 0, transcriptToolCallsCollapsedPreviewCountSetting: 3,
        transcriptWebHotTailItemCount: 0, webHotColdCountsRef: ref({ coldCount: 0, hotCount: 0 }),
    };
}

function useRootProjection(windowed = false) {
    const root = useChatListRootState({ session });
    const deps = React.useMemo(() => pipelineDeps([]), []);
    const [expanded, setExpanded] = React.useState<ReadonlySet<string>>(new Set());
    const pipeline = useTranscriptItemsPipeline({ ...deps, items: root.internalProps.items,
        groupingMode: root.internalProps.groupingMode, expandedToolCallsAnchorMessageIds: expanded,
        ...(windowed ? { targetWindowState: {
            isWindowMode: true, windowId: 'activity-window', targetSeq: 5, windowMinSeq: 4, windowMaxSeq: 6,
            olderCursor: 4, newerCursor: 6, hasMoreOlder: true, hasMoreNewer: true, activatedAtMs: 1,
        } } : {}),
    });
    return { root, pipeline, setExpanded };
}
function groups(items: readonly ChatTranscriptListItem[]) {
    return items.filter(item => item.kind === 'tool-group-header');
}
function standalone(items: readonly ChatTranscriptListItem[]) {
    return items.flatMap(item => item.kind === 'message' ? [item.messageId] : []);
}

describe('ATR-85 Terminal coordinator activity', () => {
    it.each(['linear', 'turns'] as const)('root: collapses once per reply over %s preferences, preserves actionable/status rows and expands calls', async (mode) => {
        storage.setState(state => ({ settings: { ...state.settings, transcriptGroupingMode: mode } }));
        const settings = storage.getState().settings;
        const hook = await renderHook(() => useRootProjection(), { wrapper: Coordinator });
        const collapsed = hook.getCurrent().pipeline.decomposedItems;
        expect(groups(collapsed).map(group => group.toolMessageIds)).toEqual([['read-one', 'read-two'], ['read-three']]);
        expect(standalone(collapsed)).toEqual(['user', 'progress', 'question', 'status', 'permission', 'answer', 'next-user']);
        expect(collapsed.filter(item => item.kind === 'tool-group-tool')).toHaveLength(0);
        expect(groups(collapsed).every(group => !group.expanded)).toBe(true);
        await act(async () => hook.getCurrent().setExpanded(new Set(['read-one'])));
        expect(hook.getCurrent().pipeline.decomposedItems.flatMap(item => item.kind === 'tool-group-tool' ? [item.toolMessageId] : [])).toEqual(['read-one', 'read-two']);
        expect(storage.getState().settings).toBe(settings);
        await act(async () => deskPrefs.set('chatStyle', 'mask'));
        expect(hook.getCurrent().root.internalProps.groupingMode).toBe(mode);
        expect(standalone(hook.getCurrent().pipeline.decomposedItems)).toEqual(messages.map(message => message.id));
    });

    it('root: updates eligibility and group membership without losing manual expansion or standalone chronology', async () => {
        const hook = await renderHook(() => useRootProjection(), { wrapper: Coordinator });
        const firstHeader = groups(hook.getCurrent().pipeline.decomposedItems)[0];
        expect(firstHeader?.toolMessageIds).toEqual(['read-one', 'read-two']);
        await act(async () => hook.getCurrent().setExpanded(new Set(['read-one'])));
        const resolved = messages.map(message => message.id === 'permission' ? tool('permission', 'completed', { id: 'permission-request', kind: 'permission', status: 'approved' }) : message);
        await act(async () => writeMessages([...resolved, tool('read-four', 'error')]));
        const updated = hook.getCurrent().pipeline.decomposedItems;
        expect(groups(updated)[0]).toMatchObject({ id: firstHeader!.id, expanded: true, toolMessageIds: ['read-one', 'permission', 'read-two'] });
        expect(standalone(updated)).toEqual(['user', 'progress', 'question', 'status', 'answer', 'next-user']);
        expect(groups(updated)[1].toolMessageIds).toEqual(['read-three', 'read-four']);
        // A previously completed call becoming actionable must escape even an expanded group.
        await act(async () => writeMessages(resolved.map(message => message.id === 'read-two' ? tool('read-two', 'running', { id: 'new-request', status: 'pending', kind: 'permission' }) : message)));
        expect(standalone(hook.getCurrent().pipeline.decomposedItems)).toEqual(['user', 'progress', 'question', 'status', 'read-two', 'answer', 'next-user']);
    });

    it('root: retains explicit older/newer omission rows around a target window with actionable content', async () => {
        const hook = await renderHook(() => useRootProjection(true), { wrapper: Coordinator });
        const window = hook.getCurrent().pipeline.canonicalWindowedItems;
        expect(window[0]).toMatchObject({ kind: 'transcript-window-gap', direction: 'older' });
        expect(window.at(-1)).toMatchObject({ kind: 'transcript-window-gap', direction: 'newer' });
        expect(standalone(window)).toEqual(['question', 'status', 'permission']);
        expect(groups(hook.getCurrent().pipeline.decomposedItems)).toHaveLength(2);
    });

    it('keeps short root groups closed in Terminal and retains ordinary auto-expansion', async () => {
        const request = vi.fn();
        const mark = vi.fn();
        const deps = {
            applyToolCallsGroupExpanded: request, expandedToolCallsAnchorMessageIds: new Set<string>(),
            hasAutoExpandedToolCallsGroups: () => false, isScrollable: () => false, jumpToSeq: null,
            markAutoExpandedToolCallsGroups: mark, maxTurnEntriesPerListItem: 20, pinToBottom: vi.fn(),
            preDecompositionItemsRef: ref<ChatTranscriptListItem[]>([{ kind: 'tool-calls-group', id: 'group', toolMessageIds: ['read-one', 'read-two'], createdAt: 2 }]),
            sessionEntryViewportRef: ref(null), sessionId: session.id, transcriptToolCallsCollapsedPreviewCountSetting: 1,
        };
        const hook = await renderHook(() => useTranscriptToolAutoExpandEffect(deps), { wrapper: Coordinator });
        expect(request).not.toHaveBeenCalled();
        expect(mark).not.toHaveBeenCalled();
        await act(async () => deskPrefs.set('chatStyle', 'mask'));
        await hook.rerender();
        expect(request).toHaveBeenCalledWith(expect.objectContaining({ expanded: true, toolMessageIds: ['read-one', 'read-two'] }));
    });

    it('keeps running question aliases standalone while only Terminal separates ordinary pending permissions', async () => {
        storage.setState(state => ({ settings: { ...state.settings, transcriptGroupingMode: 'turns', transcriptGroupToolCalls: true,
            transcriptTurnToolCallsGroupStrategy: 'all_tools_in_turn', toolViewTimelineChromeMode: 'activity_feed' } }));
        const question = { ...tool('alias', 'running'), tool: { ...tool('alias', 'running').tool, name: 'ask_user_question' } };
        writeMessages([tool('done'), question, tool('permission', 'running', { id: 'p', kind: 'permission', status: 'pending' })]);
        const ordinary = await renderHook(() => useRootProjection());
        expect(standalone(ordinary.getCurrent().pipeline.decomposedItems)).toContain('alias');
        expect(groups(ordinary.getCurrent().pipeline.decomposedItems)[0].toolMessageIds).toEqual(['done', 'permission']);
        const terminal = await renderHook(() => useRootProjection(), { wrapper: Coordinator });
        expect(standalone(terminal.getCurrent().pipeline.decomposedItems)).toEqual(['alias', 'permission']);
        expect(groups(terminal.getCurrent().pipeline.decomposedItems)[0].toolMessageIds).toEqual(['done']);
        await act(async () => writeMessages([tool('done'), { ...question, tool: { ...question.tool, permission: { id: 'q', kind: 'user_action', status: 'pending' } } }, tool('permission', 'running', { id: 'p', kind: 'permission', status: 'pending' })]));
        expect(standalone(terminal.getCurrent().pipeline.decomposedItems)).toEqual(['alias', 'permission']);
        await act(async () => writeMessages([tool('done'), { ...question, tool: { ...question.tool, state: 'completed' } }, tool('permission', 'completed', { id: 'p', kind: 'permission', status: 'approved' })]));
        expect(groups(terminal.getCurrent().pipeline.decomposedItems)[0].toolMessageIds).toEqual(['done', 'alias', 'permission']);
    });

    it('ordinary transcripts retain account grouping and collapsed previews outside the coordinator scope', async () => {
        storage.setState(state => ({ settings: { ...state.settings, transcriptGroupingMode: 'turns', transcriptGroupToolCalls: true,
            transcriptTurnToolCallsGroupStrategy: 'all_tools_in_turn', toolViewTimelineChromeMode: 'activity_feed' } }));
        const settings = storage.getState().settings;
        const hook = await renderHook(() => useRootProjection());
        expect(groups(hook.getCurrent().pipeline.decomposedItems)).toHaveLength(2);
        expect(hook.getCurrent().pipeline.decomposedItems.flatMap(item => item.kind === 'tool-group-tool' ? [item.toolMessageId] : [])).toEqual(['read-one', 'permission', 'read-two', 'read-three']);
        expect(storage.getState().settings).toBe(settings);
    });

    it.each(['linear', 'turns'] as const)('chain: collapses over %s preferences, preserves actionable/status rows and exposes calls on press', async (mode) => {
        storage.setState(state => ({ settings: { ...state.settings, transcriptGroupingMode: mode } }));
        const settings = storage.getState().settings;
        const chainMessages = messages.map(message => message.id === 'read-three' ? tool('read-three', 'error') : message);
        // MessageView clears appearance beneath ordinary tools. The grouping scope must
        // survive that reset for a real nested chain without leaking Terminal typography.
        const screen = await renderScreen(<AppPaneProvider><Coordinator><TranscriptAppearanceContext.Provider value={null}><ChainTranscriptList sessionId={session.id} datasetKey="activity-chain" messages={chainMessages} metadata={null}
            interaction={{ canSendMessages: true, canApprovePermissions: true }} /></TranscriptAppearanceContext.Provider></Coordinator></AppPaneProvider>);
        const headers = () => screen.tree.findAll(node => typeof node.type === 'string' && node.props.testID === 'transcript-tool-calls-header');
        expect(headers()).toHaveLength(2);
        expect(headers()[0].props.accessibilityState.expanded).toBe(false);
        expect(screen.findAllByTestId('transcript-tool-calls-unit-tool')).toHaveLength(0);
        expect(screen.getTextContent()).toContain('Provider is reconnecting');
        expect(screen.tree.findAllByType(Icon).some(icon => icon.props.name === 'warning-circle')).toBe(true);
        const list = screen.tree.findAll(node => {
            const hostType: unknown = node.type;
            return hostType === 'LegendList' || hostType === 'FlashList';
        })[0];
        const standaloneIds = standalone(list.props.data);
        // The list engine may invert its data; neither orientation may reorder action rows.
        expect([standaloneIds, [...standaloneIds].reverse()]).toContainEqual(['user', 'progress', 'question', 'status', 'permission', 'answer', 'next-user']);
        await act(async () => headers()[0].props.onPress());
        expect(headers()[0].props.accessibilityState.expanded).toBe(true);
        expect(screen.tree.findAll(node => typeof node.type === 'string' && node.props.testID === 'transcript-tool-calls-unit-tool')).toHaveLength(2);
        await act(async () => headers()[0].props.onPress());
        expect(screen.tree.findAll(node => typeof node.type === 'string' && node.props.testID === 'transcript-tool-calls-unit-tool')).toHaveLength(0);
        expect(storage.getState().settings).toBe(settings);
        await act(async () => deskPrefs.set('chatStyle', 'mask'));
        expect(headers()).toHaveLength(0);
    });
});
