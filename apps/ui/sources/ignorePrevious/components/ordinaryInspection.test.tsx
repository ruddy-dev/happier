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

it.each([false, true])('a genuine raw approval keeps distinct publication clocks and remains answerable, agent=%s', async withAgent => {
    const { tool } = seed();
    act(() => snapshot({ requests: {} }));
    // Publish an actual transcript-only row with different tool and ordering clocks.
    const entry = storage.getState().sessionMessages.inspection;
    const messageId = entry.messageIdsOldestFirst[0]!;
    const message = entry.messagesById[messageId];
    if (message.kind !== 'tool-call') throw new Error('missing transcript request');
    const published = { ...message, tool: { ...tool, createdAt: 190, permission: { id: 'r', status: 'pending' as const } } };
    const { buildTranscriptRenderableAggregate } = await import('@/sync/domains/messages/transcriptRenderableAggregate');
    act(() => storage.setState({ sessions: { inspection: { ...storage.getState().sessions.inspection,
        agentState: { requests: withAgent ? { r: request('Bash', tool.input, 150) } : {} } } },
        sessionMessages: { inspection: { ...entry, messagesById: { [messageId]: published },
        renderableAggregate: buildTranscriptRenderableAggregate({ messages: [published], completedRequests: null }) } } }));
    const screen = await renderScreen(footer(published.tool));
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


it.each(['allow', 'deny', 'transcript-allow', 'transcript-deny', 'question', 'plan-approve', 'plan-reject', 'import', 'skip'] as const)(
    'ordinary retained %s callback cannot answer a genuine same-payload reopen', async action => {
        const question = action === 'question';
        const plan = action.startsWith('plan-');
        const history = action === 'import' || action === 'skip';
        const transcript = action.startsWith('transcript-');
        const tool = question ? 'AskUserQuestion' : plan ? 'ExitPlanMode' : history ? 'AcpHistoryImport' : 'Bash';
        const input = question ? { questions: [{ header: 'Choice', question: 'Question?', options: [], freeform: { initialValue: 'answer' } }] }
            : plan ? { plan: 'Same plan' } : history ? { provider: 'acp', remoteCount: 2 } : { command: 'echo same' };
        const original = { ...request(tool, input), ...(question ? { kind: 'user_action' as const } : {}) };
        storage.getState().applySessions([createSessionFixture({ id: 'inspection', active: true, agentState: { requests: { r: original } } })]);
        storage.getState().applyMessages('inspection', []);
        const render = () => {
            const pending = listPendingSessionRequests(storage.getState().sessions.inspection).find(item => item.id === 'r')!;
            const model = buildPermissionPromptModel({ request: pending, metadata: null, nowMs: 800 });
            if (transcript) {
                const entry = storage.getState().sessionMessages.inspection;
                const message = entry.messagesById[entry.reducerState.toolIdToMessageId.get('r')!];
                if (message.kind !== 'tool-call') throw new Error('missing transcript request');
                return footer(message.tool);
            }
            if (history) return <AcpHistoryImportView tool={model.tool} sessionId="inspection" metadata={null} messages={[]} />;
            return question ? <AppPaneProvider><AskUserQuestionView tool={model.tool} sessionId="inspection" metadata={null} messages={[]} /></AppPaneProvider>
                : plan ? <ExitPlanToolView tool={model.tool} sessionId="inspection" metadata={null} messages={[]} />
                    : <PermissionPromptCard request={pending} location={null} sessionId="inspection" metadata={null} canApprovePermissions />;
        };
        const controlId = question ? 'ask-user-question.submit' : plan ? `exit-plan-${action === 'plan-approve' ? 'approve' : 'reject'}` : `permission-footer.${action.replace('transcript-', '')}`;
        const screen = await renderScreen(render());
        const control = () => history ? findPressableByText(screen.tree, t(`tools.acpHistoryImport.actions.${action}`)) : screen.findByTestId(controlId);
        const stale = control()!.props.onPress;
        act(() => snapshot({ requests: {}, completedRequests: { r: { ...original, completedAt: 400, status: 'approved' } } }));
        act(() => snapshot({ requests: { r: { ...original, createdAt: 500 }, q: request('Bash', { command: 'echo q' }, 700) }, completedRequests: {} }));
        await act(async () => { await stale(); });
        expect(decisions()).toEqual([]);
        const q = listPendingSessionRequests(storage.getState().sessions.inspection).find(item => item.id === 'q')!;
        const independent = await renderScreen(<PermissionPromptCard request={q} location={null} sessionId="inspection" metadata={null} canApprovePermissions />);
        await pressTestInstanceAsync(independent.findByTestId('permission-footer.allow')!);
        expect(decisions().map(call => call.payload.id)).toEqual(['q']);
        await screen.update(render());
        await pressTestInstanceAsync(control()!);
        expect(decisions().map(call => call.payload.id)).toEqual(['q', 'r']);
    });

it.each([[200, 500, false], [200, 200, true], [null, 500, true], [200, null, true], [null, null, true]] as const)(
    'retained composer callback without a transcript index compares producer publications %s / %s', async (before, after, allowed) => {
        const original = { tool: 'Bash', arguments: { command: 'echo same' }, createdAt: before };
        storage.getState().applySessions([createSessionFixture({ id: 'inspection', active: true, agentState: { requests: { r: original } } })]);
        const pending = listPendingSessionRequests(storage.getState().sessions.inspection)[0]!;
        const screen = await renderScreen(<PermissionPromptCard request={pending} location={null} sessionId="inspection" metadata={null} canApprovePermissions />);
        const stale = screen.findByTestId('permission-footer.allow')!.props.onPress;
        act(() => snapshot({ requests: {}, completedRequests: { r: { ...original, completedAt: 400, status: 'approved' } } }));
        act(() => snapshot({ requests: { r: { ...original, createdAt: after } }, completedRequests: {} }));
        await act(async () => { await stale(); });
        expect(decisions().map(call => call.payload.id)).toEqual(allowed ? ['r'] : []);
    });

it.each([[100, 160, false], [100, 100, true], [null, 160, true], [100, null, true], [null, null, true]] as const)(
    'cold retained ordinary callback tracks producer publications %s / %s without an index', async (before, after, allowed) => {
        storage.getState().applySessions([createSessionFixture({ id: 'inspection', active: true, agentState: { requests: {} } })]);
        const displayed = { id: 'r', kind: 'permission' as const, ...request('Bash', { command: 'echo same' }, 90) };
        const render = (pending = displayed) => <PermissionPromptCard request={pending} location={null} sessionId="inspection" metadata={null} canApprovePermissions />;
        const screen = await renderScreen(render());
        const stale = screen.findByTestId('permission-footer.allow')!.props.onPress;
        const original = { ...displayed, createdAt: before };
        act(() => snapshot({ requests: { r: original } }));
        expect(screen.findByTestId('permission-footer.allow')?.props.disabled).toBe(false);
        act(() => snapshot({ requests: {}, completedRequests: { r: { ...original, completedAt: 125, status: 'approved' } } }));
        await act(async () => { await stale(); });
        expect(decisions()).toEqual([]);
        act(() => snapshot({ requests: { r: { ...original, createdAt: after }, q: request('Bash', { command: 'echo q' }, 170) }, completedRequests: {} }));
        expect(storage.getState().sessionMessages.inspection).toBeUndefined();
        await act(async () => { await stale(); });
        expect(decisions().map(call => call.payload.id)).toEqual(allowed ? ['r'] : []);
        if (allowed) return;
        const current = listPendingSessionRequests(storage.getState().sessions.inspection);
        const q = current.find(item => item.id === 'q')!;
        const independent = await renderScreen(<PermissionPromptCard request={q} location={null} sessionId="inspection" metadata={null} canApprovePermissions />);
        await pressTestInstanceAsync(independent.findByTestId('permission-footer.allow')!);
        expect(decisions().map(call => call.payload.id)).toEqual(['q']);
        const fresh = current.find(item => item.id === 'r')!;
        await screen.update(<PermissionPromptCard request={fresh} location={null} sessionId="inspection" metadata={null} canApprovePermissions />);
        await pressTestInstanceAsync(screen.findByTestId('permission-footer.allow')!);
        expect(decisions().map(call => call.payload.id)).toEqual(['q', 'r']);
    });

it.each([false, true])('cold ordinary callback accepts its first matching producer, changed payload first=%s', async changedFirst => {
    storage.getState().applySessions([createSessionFixture({ id: 'inspection', active: true, agentState: { requests: {} } })]);
    const displayed = { id: 'r', kind: 'permission' as const, ...request('Bash', { command: 'echo original' }, 90) };
    const screen = await renderScreen(<PermissionPromptCard request={displayed} location={null} sessionId="inspection" metadata={null} canApprovePermissions />);
    const stale = screen.findByTestId('permission-footer.allow')!.props.onPress;
    if (changedFirst) {
        act(() => snapshot({ requests: { r: request('Bash', { command: 'echo changed' }, 100) } }));
        await act(async () => { await stale(); });
        expect(decisions()).toEqual([]);
    }
    act(() => snapshot({ requests: { r: request('Bash', displayed.arguments, 160) } }));
    expect(storage.getState().sessionMessages.inspection).toBeUndefined();
    await act(async () => { await stale(); });
    expect(decisions().map(call => call.payload.id)).toEqual(changedFirst ? [] : ['r']);
});

it.each(['permission', 'user_action'] as const)('real-store Voice %s cannot redirect an inspection-only current request', async kind => {
    const question = kind === 'user_action';
    const input = question ? { questions: [{ question: 'Question B?', options: [] }] } : { command: 'echo B' };
    const completedInput = question ? { questions: [{ question: 'Question A?', options: [] }] } : { command: 'echo A' };
    seed(question ? 'AskUserQuestion' : 'Bash', input, completedInput);
    const otherInput = question ? { questions: [{ question: 'Question q?', options: [] }] } : { command: 'echo q' };
    act(() => storage.getState().applySessions([createSessionFixture({ id: 'other', active: true,
        agentState: { requests: { q: { ...request(question ? 'AskUserQuestion' : 'Bash', otherInput, 700), kind } } } })]));
    const { createVoiceToolHandlers } = await import('@/voice/tools/handlers');
    const tools = createVoiceToolHandlers({ resolveSessionId: explicit => explicit ?? 'inspection' });
    const answer = (parameters = {}) => question
        ? tools.answerUserActionRequest({ answers: [{ question: 'Question q?', answer: 'answer' }], ...parameters })
        : tools.processPermissionRequest({ decision: 'allow', ...parameters });
    expect(JSON.parse(await answer())).toMatchObject({ ok: false, errorCode: 'permission_request_requires_inspection', sessionId: 'inspection' });
    expect(decisions()).toEqual([]);
    expect(JSON.parse(await answer({ sessionId: 'other' }))).toMatchObject({ ok: true, sessionId: 'other', requestId: 'q' });
    expect(decisions()).toMatchObject([{ sessionId: 'other', payload: { id: 'q' } }]);
});
