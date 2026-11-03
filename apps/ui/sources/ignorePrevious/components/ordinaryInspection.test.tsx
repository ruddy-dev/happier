import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act } from 'react-test-renderer';
import { createSessionFixture, renderScreen, pressTestInstanceAsync, standardCleanup, findPressableByText } from '@/dev/testkit';
import { storage } from '@/sync/domains/state/storage';
import { listPendingSessionRequests } from '@/sync/domains/session/pending/listPendingSessionRequests';
import type { AgentState } from '@/sync/domains/state/storageTypes';
import { PermissionFooter } from '@/components/tools/shell/permissions/PermissionFooter';
import { PermissionPromptCard } from '@/components/tools/shell/permissions/PermissionPromptCard';
import { AskUserQuestionView } from '@/components/tools/renderers/workflow/AskUserQuestionView';
import { ExitPlanToolView } from '@/components/tools/renderers/workflow/ExitPlanToolView';
import { AppPaneProvider } from '@/components/appShell/panes/AppPaneProvider';
import { t } from '@/text';
import { AcpHistoryImportView } from '@/components/tools/renderers/system/AcpHistoryImportView';
import { buildPermissionPromptModel } from '@/components/tools/shell/permissions/presentation/buildPermissionPromptModel';
import { ToolView } from '@/components/tools/shell/views/ToolView';
import { ToolTimelineRow } from '@/components/tools/shell/views/ToolTimelineRow';
import { ToolFullView } from '@/components/tools/shell/views/ToolFullView';
import { UserActionPromptCard } from '@/components/tools/shell/userActions/UserActionPromptCard';
import { usePendingRequestActionability } from '@/components/tools/shell/permissions/usePendingRequestActionability';
import type { ToolCall } from '@/sync/domains/messages/messageTypes';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('@/sync/runtime/orchestration/serverScopedRpc/serverScopedSessionRpc', async (importOriginal) => {
    const { installServerScopedSessionRpcModuleMock } = await import('@/dev/testkit/mocks/serverScopedRpc');
    return installServerScopedSessionRpcModuleMock({ sessionRpcWithServerScope: rpc })(importOriginal);
});
vi.mock('@/sync/sync', async () => {
    const { installSyncStub } = await import('@/dev/testkit/mocks/sync');
    return installSyncStub()();
});
vi.mock('expo-router', async () => {
    const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
    return createExpoRouterMock().module;
});
vi.mock('@/modal', async () => {
    const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
    return createModalModuleMock().module;
});
vi.mock('@expo/vector-icons', async () => {
    const { createExpoVectorIconsMock } = await import('@/dev/testkit/mocks/icons');
    return createExpoVectorIconsMock();
});
vi.mock('@react-navigation/native', async () => {
    const { createReactNavigationNativeMock } = await import('@/dev/testkit/mocks/reactNavigation');
    return createReactNavigationNativeMock();
});

let previous: ReturnType<typeof storage.getState>;
beforeEach(() => {
    previous = storage.getState();
    storage.setState({ sessions: {}, sessionMessages: {}, sessionListRenderables: {} });
    rpc.mockReset().mockResolvedValue({ ok: true });
});
afterEach(() => { standardCleanup(); act(() => storage.setState(previous, true)); });
const request = (tool: string, arguments_: unknown, createdAt = 200) => ({ tool, arguments: arguments_, createdAt });
function snapshot(agentState: AgentState) {
    const session = storage.getState().sessions.inspection;
    storage.getState().applySessions([{ ...session, agentStateVersion: session.agentStateVersion + 1, agentState }]);
}
function seed(tool = 'Bash', input: unknown = { command: 'echo B' }, completedInput: unknown = { command: 'echo A' }) {
    storage.getState().applySessions([createSessionFixture({ id: 'inspection', active: true,
        agentState: { requests: { r: request(tool, input) } } })]);
    storage.getState().applyMessages('inspection', []);
    snapshot({ requests: {}, completedRequests: { r: { ...request(tool, completedInput, 500), completedAt: 600, status: 'approved' } } });
    const session = storage.getState().sessions.inspection;
    const pending = listPendingSessionRequests(session);
    expect(pending).toMatchObject([{ id: 'r', requiresInspection: true, arguments: input }]);
    const entry = storage.getState().sessionMessages.inspection;
    const messages = entry.messageIdsOldestFirst.map(id => entry.messagesById[id]);
    expect(messages.filter(message => message.kind === 'tool-call')).toHaveLength(1);
    const message = messages.find(message => message.kind === 'tool-call');
    if (message?.kind !== 'tool-call') throw new Error('missing main tool');
    expect(message.children).toHaveLength(0);
    return { pending: pending[0]!, tool: message.tool };
}
const decisions = () => rpc.mock.calls.map(([call]) => call).filter(call => call.method === 'permission');
const ToolDetail = (props: React.ComponentProps<typeof ToolView>) => <ToolFullView tool={props.tool} owningMessageId="main" sessionId={props.sessionId} metadata={props.metadata} messages={props.messages} forcePermissionFooterInTranscript />;
function footer(tool: ToolCall) {
    return <PermissionFooter permission={tool.permission!} sessionId="inspection" toolName={tool.name} toolInput={tool.input} requestCreatedAt={tool.createdAt} />;
}

it.each(['allow', 'deny'])('main-only B stays inspectable through ordinary composer and transcript: %s', async action => {
    const { pending, tool } = seed();
    const composer = await renderScreen(<PermissionPromptCard request={pending} location={null} sessionId="inspection" metadata={null} canApprovePermissions />);
    const transcript = await renderScreen(footer(tool));
    for (const screen of [composer, transcript]) {
        const control = screen.findByTestId(`permission-footer.${action}`);
        if (control) await pressTestInstanceAsync(control);
    }
    expect(decisions()).toEqual([]);
    act(() => snapshot({ ...storage.getState().sessions.inspection.agentState, requests: { q: request('Bash', { command: 'echo q' }, 700) } }));
    const q = listPendingSessionRequests(storage.getState().sessions.inspection).find(item => item.id === 'q')!;
    const independent = await renderScreen(<PermissionPromptCard request={q} location={null} sessionId="inspection" metadata={null} canApprovePermissions />);
    await pressTestInstanceAsync(independent.findByTestId(`permission-footer.${action}`)!);
    expect(decisions().map(call => call.payload.id)).toEqual(['q']);
});

it.each(['allow', 'deny'])('stale displayed B cannot answer refreshed A, but refreshed A can: %s', async action => {
    storage.getState().applySessions([createSessionFixture({ id: 'inspection', active: true,
        agentState: { requests: { r: request('Bash', { command: 'echo B' }) } } })]);
    const pending = listPendingSessionRequests(storage.getState().sessions.inspection)[0]!;
    const screen = await renderScreen(<PermissionPromptCard request={pending} location={null} sessionId="inspection" metadata={null} canApprovePermissions />);
    const stale = screen.findByTestId(`permission-footer.${action}`)!.props.onPress;
    act(() => snapshot({ requests: { r: request('Bash', { command: 'echo A' }, 700) } }));
    await act(async () => { await stale(); });
    expect(decisions()).toEqual([]);
    const refreshed = listPendingSessionRequests(storage.getState().sessions.inspection)[0]!;
    await screen.update(<PermissionPromptCard request={refreshed} location={null} sessionId="inspection" metadata={null} canApprovePermissions />);
    await pressTestInstanceAsync(screen.findByTestId(`permission-footer.${action}`)!);
    expect(decisions().map(call => call.payload.id)).toEqual(['r']);
});

it('classification-only updates reach retained composer props', async () => {
    storage.getState().applySessions([createSessionFixture({ id: 'inspection', active: true,
        agentState: { requests: { r: request('Bash', { command: 'echo B' }) } } })]);
    const pending = listPendingSessionRequests(storage.getState().sessions.inspection)[0]!;
    const screen = await renderScreen(<PermissionPromptCard request={pending} location={null} sessionId="inspection" metadata={null} canApprovePermissions />);
    const stale = screen.findByTestId('permission-footer.allow')!.props.onPress;
    act(() => snapshot({ requests: {}, completedRequests: { r: { ...request('Bash', { command: 'echo A' }, 500), completedAt: 600, status: 'approved' } } }));
    await act(async () => { await stale(); });
    expect(decisions()).toEqual([]);
    expect(screen.findByTestId('permission-footer.allow')?.props.disabled ?? true).toBe(true);
});

it.each(['exit-plan-approve', 'exit-plan-reject'])('interactive plan preview cannot answer main-only B: %s', async action => {
    const { tool, pending } = seed('ExitPlanMode', { plan: 'Plan B' }, { plan: 'Plan A' });
    const preview = await renderScreen(<PermissionPromptCard request={pending} location={null} sessionId="inspection" metadata={null} canApprovePermissions />);
    const transcript = await renderScreen(<ExitPlanToolView tool={tool} sessionId="inspection" metadata={null} messages={[]} />);
    for (const screen of [preview, transcript]) {
        const control = screen.findByTestId(action);
        if (control) await pressTestInstanceAsync(control);
    }
    expect(decisions()).toEqual([]);
});

it('a retained question callback cannot answer a different same-ID question', async () => {
    const input = { questions: [{ header: 'Choice', question: 'Question B?', options: [], freeform: { initialValue: 'answer' } }] };
    storage.getState().applySessions([createSessionFixture({ id: 'inspection', active: true,
        agentState: { requests: { r: { ...request('AskUserQuestion', input), kind: 'user_action' } } } })]);
    storage.getState().applyMessages('inspection', []);
    const entry = storage.getState().sessionMessages.inspection;
    const message = entry.messagesById[entry.messageIdsOldestFirst[0]!];
    if (message.kind !== 'tool-call') throw new Error('missing question');
    const screen = await renderScreen(<AppPaneProvider><AskUserQuestionView tool={message.tool} sessionId="inspection" metadata={null} messages={[]} /></AppPaneProvider>);
    const stale = screen.findByTestId('ask-user-question.submit')!.props.onPress;
    act(() => snapshot({ requests: { r: { ...request('AskUserQuestion', { questions: [{ ...input.questions[0], question: 'Question A?' }] }, 700), kind: 'user_action' } } }));
    await act(async () => { await stale(); });
    expect(decisions()).toEqual([]);
    const refreshed = listPendingSessionRequests(storage.getState().sessions.inspection).find(item => item.id === 'r')!;
    const model = buildPermissionPromptModel({ request: refreshed, metadata: null, nowMs: 800 });
    await screen.update(<AppPaneProvider><AskUserQuestionView tool={model.tool} sessionId="inspection" metadata={null} messages={[]} /></AppPaneProvider>);
    await pressTestInstanceAsync(screen.findByTestId('ask-user-question.submit')!);
    expect(decisions().map(call => call.payload.id)).toEqual(['r']);
    expect(decisions()[0].payload.answers).toEqual({ 'Question A?': 'answer' });
});

it('main-only question B is inspectable while independent question q can be answered', async () => {
    const input = { questions: [{ header: 'Choice', question: 'Question B?', options: [], freeform: { initialValue: 'answer' } }] };
    const { pending, tool } = seed('AskUserQuestion', input, { questions: [{ ...input.questions[0], question: 'Question A?' }] });
    const preview = await renderScreen(<AppPaneProvider><UserActionPromptCard request={pending} location={null} sessionId="inspection" metadata={null} canApprovePermissions /></AppPaneProvider>);
    const transcript = await renderScreen(<AppPaneProvider><AskUserQuestionView tool={tool} sessionId="inspection" metadata={null} messages={[]} /></AppPaneProvider>);
    for (const screen of [preview, transcript]) {
        expect(screen.getTextContent()).toContain('Question B?');
        expect(screen.findByTestId('ask-user-question.submit')).toBeNull();
        expect(screen.findByTestId('permission-footer.allow')).toBeNull();
        expect(screen.findByTestId('permission-footer.deny')).toBeNull();
    }
    expect(decisions()).toEqual([]);
    act(() => snapshot({ ...storage.getState().sessions.inspection.agentState,
        requests: { q: { ...request('AskUserQuestion', { questions: [{ ...input.questions[0], question: 'Question q?' }] }, 700), kind: 'user_action' } } }));
    const q = listPendingSessionRequests(storage.getState().sessions.inspection).find(item => item.id === 'q')!;
    await preview.update(<AppPaneProvider><UserActionPromptCard request={q} location={null} sessionId="inspection" metadata={null} canApprovePermissions /></AppPaneProvider>);
    await pressTestInstanceAsync(preview.findByTestId('ask-user-question.submit')!);
    expect(decisions().map(call => call.payload.id)).toEqual(['q']);
    expect(decisions()[0].payload.answers).toEqual({ 'Question q?': 'answer' });
});


it.each([ToolView, ToolTimelineRow, ToolDetail])('real transcript shell preserves inspection content and blocks B', async Shell => {
    const { tool } = seed();
    const screen = await renderScreen(<Shell tool={tool} sessionId="inspection" metadata={null} messages={[]} forcePermissionPromptsInTranscript />);
    expect(screen.root.findAllByType(PermissionFooter)).toHaveLength(1);
    expect(screen.findByTestId('permission-footer.allow')).toBeNull();
    expect(screen.findByTestId('permission-footer.deny')).toBeNull();
    expect(decisions()).toEqual([]);
});

it('a genuine transcript-only approval keeps its tool start time and remains answerable', async () => {
    const { tool } = seed();
    act(() => snapshot({ requests: {} }));
    // Transcript ordering time and tool start time are different clocks/roles.
    const screen = await renderScreen(footer({ ...tool, createdAt: 190, permission: { id: 'r', status: 'pending' } }));
    await pressTestInstanceAsync(screen.findByTestId('permission-footer.allow')!);
    expect(decisions().map(call => call.payload.id)).toEqual(['r']);
});

it.each([ToolView, ToolTimelineRow, ToolDetail])('real transcript normalization preserves a genuine raw request occurrence', async Shell => {
    const input = { command: ['bash', '-lc', 'echo genuine'] };
    storage.getState().applySessions([createSessionFixture({ id: 'inspection', active: true,
        agentState: { requests: { r: request('execute', input) } } })]);
    storage.getState().applyMessages('inspection', []);
    const entry = storage.getState().sessionMessages.inspection;
    const message = entry.messagesById[entry.messageIdsOldestFirst[0]!];
    if (message.kind !== 'tool-call') throw new Error('missing request');
    const screen = await renderScreen(<Shell tool={message.tool} sessionId="inspection" metadata={null} messages={[]} forcePermissionPromptsInTranscript />);
    await pressTestInstanceAsync(screen.findByTestId('permission-footer.allow')!);
    expect(decisions().map(call => call.payload.id)).toEqual(['r']);
});

it('normalized indexed eligibility does not read history or rerender on token-only writes', async () => {
    storage.getState().applySessions([createSessionFixture({ id: 'inspection', active: true,
        agentState: { requests: { r: request('Bash', { command: 'echo B' }) } } })]);
    storage.getState().applyMessages('inspection', []);
    const pending = listPendingSessionRequests(storage.getState().sessions.inspection)[0]!;
    const entry = storage.getState().sessionMessages.inspection;
    expect(entry.renderableAggregate).toBeDefined();
    let historyReads = 0;
    let renders = 0;
    const indexed = { ...entry, get messagesById() { historyReads++; return entry.messagesById; } };
    act(() => storage.setState({ sessionMessages: { inspection: indexed } }));
    function Eligibility() {
        renders++;
        const { actionable } = usePendingRequestActionability('inspection', pending);
        return <React.Fragment>{String(actionable)}</React.Fragment>;
    }
    await renderScreen(<Eligibility />);
    const before = renders;
    for (let index = 0; index < 3; index++) {
        act(() => storage.setState({ sessionMessages: { inspection: { ...entry, get messagesById() { historyReads++; return entry.messagesById; },
            renderableAggregate: entry.renderableAggregate, messagesVersion: entry.messagesVersion + index + 1 } } }));
    }
    expect(historyReads).toBe(0);
    expect(renders).toBe(before);
    act(() => snapshot({ requests: {}, completedRequests: { r: { ...request('Bash', { command: 'echo A' }, 500), completedAt: 600, status: 'approved' } } }));
    expect(renders).toBeGreaterThan(before);
});


it.each(['exit-plan-approve', 'exit-plan-reject', 'exit-plan-request-changes-send'])('retained plan actions reject B and refreshed A remains actionable: %s', async action => {
    storage.getState().applySessions([createSessionFixture({ id: 'inspection', active: true,
        agentState: { requests: { r: request('ExitPlanMode', { plan: 'Plan B' }) } } })]);
    const model = () => buildPermissionPromptModel({ request: listPendingSessionRequests(storage.getState().sessions.inspection)[0]!, metadata: null, nowMs: 800 });
    const screen = await renderScreen(<ExitPlanToolView tool={model().tool} sessionId="inspection" metadata={null} messages={[]} />);
    if (action === 'exit-plan-request-changes-send') {
        await pressTestInstanceAsync(screen.findByTestId('exit-plan-request-changes')!);
        act(() => screen.changeTextByTestId('exit-plan-request-changes-input', 'Please revise'));
    }
    const stale = screen.findByTestId(action)!.props.onPress;
    act(() => snapshot({ requests: { r: request('ExitPlanMode', { plan: 'Plan A' }, 700) } }));
    await act(async () => { await stale(); });
    expect(decisions()).toEqual([]);
    await screen.update(<ExitPlanToolView tool={model().tool} sessionId="inspection" metadata={null} messages={[]} />);
    await pressTestInstanceAsync(screen.findByTestId(action)!);
    expect(decisions().map(call => call.payload.id)).toEqual(['r']);
});

it.each(['import', 'skip'] as const)('history import controls cannot answer inspection-only main B: %s', async action => {
    const { tool } = seed('AcpHistoryImport', { provider: 'acp', remoteCount: 2 }, { provider: 'acp', remoteCount: 3 });
    const screen = await renderScreen(<AcpHistoryImportView tool={tool} sessionId="inspection" metadata={null} messages={[]} />);
    const control = findPressableByText(screen.tree, t(`tools.acpHistoryImport.actions.${action}`));
    if (control) await pressTestInstanceAsync(control);
    expect(decisions()).toEqual([]);
});
