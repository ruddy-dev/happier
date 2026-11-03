import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createSessionFixture, pressTestInstanceAsync, renderScreen } from '@/dev/testkit';
import { storage } from '@/sync/domains/state/storage';
import type { Session } from '@/sync/domains/state/storageTypes';
import { createWaitingHistory, WaitingPanel } from './WaitingPanel';
import { t } from '@/text';
import { createDeferred } from '@/dev/testkit/hooks/createDeferred';
import type { SessionPermissionResult } from '@/sync/ops/sessions';

const boundary = vi.hoisted(() => ({ allow: vi.fn(), deny: vi.fn(), answer: vi.fn() }));
// Operations are the outgoing boundary; request projection, store and dispatch guard stay real.
vi.mock('@/sync/ops', () => ({ sessionAllowResult: boundary.allow, sessionDenyResult: boundary.deny, sessionAllowWithAnswers: boundary.answer }));
vi.mock('@/modal', async () => {
    const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
    return createModalModuleMock().module;
});
vi.mock('@/sync/sync', async () => {
    const { installSyncStub } = await import('@/dev/testkit/mocks/sync');
    return installSyncStub()();
});
vi.mock('@react-navigation/native', async () => {
    const { createReactNavigationNativeMock } = await import('@/dev/testkit/mocks/reactNavigation');
    return createReactNavigationNativeMock();
});
vi.mock('expo-router', async () => {
    const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
    return createExpoRouterMock().module;
});

let previous: ReturnType<typeof storage.getState>;
beforeEach(() => {
    previous = storage.getState();
    boundary.allow.mockReset().mockResolvedValue({ ok: true });
    boundary.deny.mockReset().mockResolvedValue({ ok: true });
    boundary.answer.mockReset().mockResolvedValue(undefined);
});
afterEach(() => { act(() => storage.setState(previous, true)); });

function worker(id: string, command: string, tool = 'Bash'): Session {
    return createSessionFixture({ id, active: true, agentState: { requests: {
        shared: { tool, arguments: { command }, createdAt: 1 },
    } } });
}
function seed(sessions: Session[]) {
    act(() => {
        storage.getState().setSocketStatus('connected');
        storage.getState().applySessions(sessions);
        storage.getState().applyReady();
    });
}

function questionWorker(text = 'Which checks?'): Session {
    return createSessionFixture({ id: 'question-worker', active: true, agentState: { requests: {
        question: { tool: 'AskUserQuestion', kind: 'user_action', arguments: { questions: [{
            header: 'Checks\u202E', question: text, options: [{ label: 'Unit\u2066', description: 'Run <checks>\u200B' }], freeform: {},
        }] }, createdAt: 1 },
    } } });
}

it.each(['allow', 'deny', 'answer'] as const)('reopened %s reacts to the earlier send settling while the same request stays listed', async action => {
    const pending = createDeferred<SessionPermissionResult | void>();
    boundary[action].mockReturnValueOnce(pending.promise);
    seed([action === 'answer' ? questionWorker() : worker('worker', 'echo check')]);
    const history = createWaitingHistory();
    const requestId = action === 'answer' ? 'question' : 'shared';
    const actionId = `ip-waiting-${action === 'answer' ? 'send' : action}-${requestId}`;
    const first = await renderScreen(<WaitingPanel history={history} />);
    await pressTestInstanceAsync(first.findByTestId(`ip-waiting-toggle-${requestId}`));
    if (action === 'answer') await pressTestInstanceAsync(first.findByTestId('ip-waiting-option-question-0-0'));
    await pressTestInstanceAsync(first.findByTestId(actionId));
    act(() => first.tree.unmount());
    const reopened = await renderScreen(<WaitingPanel history={history} />);
    await pressTestInstanceAsync(reopened.findByTestId(`ip-waiting-toggle-${requestId}`));
    // Complete the new draft as well: its empty state must not hide a lost sending/sent state.
    if (action === 'answer') act(() => reopened.tree.changeTextByTestId('ip-waiting-other-question-0', 'second answer'));
    const sending = reopened.findByTestId(actionId)?.props.accessibilityState;
    try {
        await pressTestInstanceAsync(reopened.findByTestId(actionId));
        expect(boundary[action]).toHaveBeenCalledTimes(1);
    } finally {
        await act(async () => pending.resolve(action === 'answer' ? undefined : { ok: true }));
    }
    const settled = reopened.findByTestId(actionId)?.props.disabled;
    await pressTestInstanceAsync(reopened.findByTestId(actionId));
    if (action !== 'answer') await pressTestInstanceAsync(reopened.findByTestId(`ip-waiting-${action === 'allow' ? 'deny' : 'allow'}-shared`));
    expect(boundary.allow.mock.calls.length + boundary.deny.mock.calls.length + boundary.answer.mock.calls.length).toBe(1);
    expect(sending).toMatchObject({ disabled: true, busy: true });
    expect(settled).toBe(true);
});

it.each(['allow', 'deny', 'answer'] as const)('reopened %s permits a retry after the earlier send fails', async action => {
    const pending = createDeferred<SessionPermissionResult | void>();
    boundary[action].mockReturnValueOnce(pending.promise);
    seed([action === 'answer' ? questionWorker() : worker('worker', 'echo retry')]);
    const history = createWaitingHistory();
    const requestId = action === 'answer' ? 'question' : 'shared';
    const actionId = `ip-waiting-${action === 'answer' ? 'send' : action}-${requestId}`;
    const first = await renderScreen(<WaitingPanel history={history} />);
    await pressTestInstanceAsync(first.findByTestId(`ip-waiting-toggle-${requestId}`));
    if (action === 'answer') act(() => first.tree.changeTextByTestId('ip-waiting-other-question-0', 'discarded draft'));
    await pressTestInstanceAsync(first.findByTestId(actionId));
    act(() => first.tree.unmount());
    const reopened = await renderScreen(<WaitingPanel history={history} />);
    await pressTestInstanceAsync(reopened.findByTestId(`ip-waiting-toggle-${requestId}`));
    const sending = reopened.findByTestId(actionId)?.props.accessibilityState;
    if (action === 'answer') expect(reopened.findByTestId('ip-waiting-other-question-0')?.props.value).toBe('');
    await act(async () => pending.reject(new Error('offline')));
    if (action === 'answer') {
        expect(reopened.findByTestId('ip-waiting-question-error-question')?.props.accessibilityRole).toBe('alert');
        act(() => reopened.tree.changeTextByTestId('ip-waiting-other-question-0', 'fresh retry'));
    }
    expect(reopened.findByTestId(actionId)?.props.disabled).toBe(false);
    await pressTestInstanceAsync(reopened.findByTestId(actionId));
    expect(boundary[action]).toHaveBeenCalledTimes(2);
    expect(reopened.findByTestId(actionId)?.props.disabled).toBe(true);
    expect(sending).toMatchObject({ disabled: true, busy: true });
    if (action === 'answer') expect(JSON.stringify(boundary.answer.mock.calls[1])).not.toContain('discarded draft');
});

it.each([{ accessLevel: 'view' as const }, { accessLevel: 'edit' as const, canApprovePermissions: false }])(
    'R10: readable escaped questions without mutation controls for %j, including replacements and permission changes', async access => {
        const original = questionWorker('Choose <safe>\u202E');
        seed([{ ...original, ...access }]);
        const screen = await renderScreen(<WaitingPanel />);
        await pressTestInstanceAsync(screen.findByTestId('ip-waiting-toggle-question'));
        expect(screen.getTextContent()).toContain('Choose <safe>⟨U+202E⟩');
        expect(screen.getTextContent()).toContain('Checks⟨U+202E⟩');
        expect(screen.getTextContent()).toContain('Unit⟨U+2066⟩');
        expect(screen.getTextContent()).toContain('Run <checks>⟨U+200B⟩');
        expect(screen.findByTestId('ip-waiting-option-question-0-0')).toBeNull();
        expect(screen.findByTestId('ip-waiting-other-question-0')).toBeNull();
        expect(screen.findByTestId('ip-waiting-send-question')).toBeNull();
        expect(screen.findByTestId('ip-waiting-allow-question')).toBeNull();
        expect(screen.findByTestId('ip-waiting-deny-question')).toBeNull();
        act(() => storage.getState().applySessions([{ ...original, accessLevel: 'edit', canApprovePermissions: true, updatedAt: 2 }]));
        act(() => screen.tree.changeTextByTestId('ip-waiting-other-question-0', 'stale secret draft'));
        const staleSend = screen.findByTestId('ip-waiting-send-question')!.props.onPress;
        await act(async () => { storage.getState().applySessions([{ ...original, ...access, updatedAt: 3 }]); staleSend(); });
        expect(boundary.answer).not.toHaveBeenCalled();
        expect(screen.findByTestId('ip-waiting-send-question')).toBeNull();
        expect(screen.getTextContent()).not.toContain('stale secret draft');
        act(() => storage.getState().applySessions([{ ...original, accessLevel: 'edit', canApprovePermissions: true, updatedAt: 4 }]));
        expect(screen.findByTestId('ip-waiting-other-question-0')?.props.value).toBe('');
        await act(async () => staleSend());
        expect(boundary.answer).not.toHaveBeenCalled();
        act(() => storage.getState().applySessions([{ ...original, ...access, updatedAt: 5 }]));
        const replacement = questionWorker('Replacement\u202E');
        act(() => storage.getState().applySessions([{ ...replacement, ...access, agentStateVersion: 2, updatedAt: 6 }]));
        expect(screen.findByTestId('ip-waiting-changed-question')).not.toBeNull();
        await pressTestInstanceAsync(screen.findByTestId('ip-waiting-toggle-question'));
        expect(screen.getTextContent()).toContain('Replacement⟨U+202E⟩');
        expect(screen.getTextContent()).not.toContain('Choose <safe>');
        expect(screen.findByTestId('ip-waiting-send-question')).toBeNull();
        act(() => storage.getState().applySessions([{ ...replacement, agentStateVersion: 2, accessLevel: 'edit', canApprovePermissions: true, updatedAt: 7 }]));
        expect(screen.findByTestId('ip-waiting-other-question-0')?.props.value).toBe('');
        await act(async () => staleSend());
        expect(boundary.answer).not.toHaveBeenCalled();
    },
);

it('a reopened pending question cannot settle onto replacement content or leak its old draft', async () => {
    const pending = createDeferred<void>(); boundary.answer.mockReturnValueOnce(pending.promise);
    const original = questionWorker('Original\u202E'); seed([original]);
    const history = createWaitingHistory();
    const first = await renderScreen(<WaitingPanel history={history} />);
    await pressTestInstanceAsync(first.findByTestId('ip-waiting-toggle-question'));
    act(() => first.tree.changeTextByTestId('ip-waiting-other-question-0', 'old draft'));
    const oldSend = first.findByTestId('ip-waiting-send-question')!.props.onPress;
    await act(async () => oldSend());
    act(() => first.tree.unmount());
    const reopened = await renderScreen(<WaitingPanel history={history} />);
    await pressTestInstanceAsync(reopened.findByTestId('ip-waiting-toggle-question'));
    act(() => storage.getState().applySessions([{ ...questionWorker('Original⟨U+202E⟩'), agentStateVersion: 2 }]));
    expect(reopened.findByTestId('ip-waiting-changed-question')).not.toBeNull();
    await pressTestInstanceAsync(reopened.findByTestId('ip-waiting-toggle-question'));
    expect(reopened.findByTestId('ip-waiting-other-question-0')).toBeNull();
    expect(reopened.findByTestId('ip-waiting-earlier-question')).not.toBeNull();
    try {
        expect(reopened.findByTestId('ip-waiting-send-question')).toBeNull();
        expect(boundary.answer).toHaveBeenCalledTimes(1); // The real shared transport lock still belongs to A.
    } finally { await act(async () => pending.resolve()); }
    await act(async () => oldSend());
    expect(boundary.answer).toHaveBeenCalledTimes(1);
    expect(reopened.findByTestId('ip-waiting-send-question')?.props.disabled).not.toBe(false);
    expect(reopened.findByTestId('ip-waiting-send-question')).toBeNull();
    expect(boundary.answer).toHaveBeenCalledTimes(1);
    expect(reopened.getTextContent()).not.toContain('old draft');
});

it('a new desk lifecycle does not inherit sent state from the previous desk', async () => {
    seed([worker('worker', 'echo same')]);
    const first = await renderScreen(<WaitingPanel history={createWaitingHistory()} />);
    await pressTestInstanceAsync(first.findByTestId('ip-waiting-toggle-shared'));
    await pressTestInstanceAsync(first.findByTestId('ip-waiting-allow-shared'));
    act(() => first.tree.unmount());
    const nextDesk = await renderScreen(<WaitingPanel history={createWaitingHistory()} />);
    await pressTestInstanceAsync(nextDesk.findByTestId('ip-waiting-toggle-shared'));
    expect(nextDesk.findByTestId('ip-waiting-allow-shared')?.props.disabled).toBe(false);
    await pressTestInstanceAsync(nextDesk.findByTestId('ip-waiting-allow-shared'));
    expect(boundary.allow).toHaveBeenCalledTimes(2);
});

it.each(['success', 'failure'] as const)('a removed request cannot pass late %s state to its next occurrence', async result => {
    const pending = createDeferred<SessionPermissionResult>(); boundary.allow.mockReturnValueOnce(pending.promise);
    const original = worker('worker', 'echo same'); seed([original]);
    const history = createWaitingHistory();
    const first = await renderScreen(<WaitingPanel history={history} />);
    await pressTestInstanceAsync(first.findByTestId('ip-waiting-toggle-shared'));
    await pressTestInstanceAsync(first.findByTestId('ip-waiting-allow-shared'));
    act(() => first.tree.unmount());
    const reopened = await renderScreen(<WaitingPanel history={history} />);
    act(() => storage.getState().applySessions([{ ...original, agentStateVersion: 2, agentState: { requests: {} } }]));
    expect(reopened.findByTestId('ip-answered-shared')).not.toBeNull();
    await act(async () => result === 'success' ? pending.resolve({ ok: true }) : pending.reject(new Error('offline')));
    if (result === 'success') expect(reopened.getTextContent()).toContain(t('ignorePrevious.waiting.allowed'));
    act(() => storage.getState().applySessions([{ ...original, agentStateVersion: 3 }]));
    await pressTestInstanceAsync(reopened.findByTestId('ip-waiting-toggle-shared'));
    expect(reopened.findByTestId('ip-waiting-allow-shared')?.props.disabled).toBe(false);
    await pressTestInstanceAsync(reopened.findByTestId('ip-waiting-allow-shared'));
    expect(boundary.allow).toHaveBeenCalledTimes(2);
});

it('R46: starts compact; opening and collapsing never answer; full detail precedes Allow', async () => {
    const command = 'echo start ' + 'argument '.repeat(40) + '&& echo final-command-tail';
    seed([worker('worker', command)]);
    const screen = await renderScreen(<WaitingPanel />);
    expect(screen.findByTestId('ip-waiting-allow-shared')).toBeNull();
    expect(screen.getTextContent()).not.toContain('final-command-tail');
    const toggle = () => screen.findByTestId('ip-waiting-toggle-shared');
    expect(toggle()?.props.accessibilityState).toMatchObject({ expanded: false });
    await pressTestInstanceAsync(toggle());
    expect(toggle()?.props.accessibilityState).toMatchObject({ expanded: true });
    expect(screen.getTextContent()).toContain(command);
    expect(screen.findByTestId('ip-waiting-detail-shared')).not.toBeNull();
    await pressTestInstanceAsync(toggle());
    expect(boundary.allow).not.toHaveBeenCalled(); expect(boundary.deny).not.toHaveBeenCalled();
    await pressTestInstanceAsync(toggle());
    await pressTestInstanceAsync(screen.findByTestId('ip-waiting-allow-shared'));
    await pressTestInstanceAsync(toggle()); await pressTestInstanceAsync(toggle());
    expect(screen.findByTestId('ip-waiting-allow-shared')?.props.disabled).toBe(true);
    expect(boundary.allow).toHaveBeenCalledExactlyOnceWith('worker', 'shared');
});

it('R46: a collapsed question retains dirty text and choices without submitting', async () => {
    const session = createSessionFixture({ id: 'question-worker', active: true, agentState: { requests: {
        question: { tool: 'AskUserQuestion', kind: 'user_action', arguments: { questions: [{
            question: 'Which checks?', options: [{ label: 'Unit' }], multiSelect: true, freeform: {},
        }] }, createdAt: 1 },
    } } });
    seed([session]); const dirty = vi.fn();
    const screen = await renderScreen(<WaitingPanel onDirtyChange={dirty} />);
    const toggle = () => screen.findByTestId('ip-waiting-toggle-question');
    await pressTestInstanceAsync(toggle());
    act(() => screen.tree.changeTextByTestId('ip-waiting-other-question-0', 'Keep this answer'));
    await pressTestInstanceAsync(toggle());
    expect(dirty).toHaveBeenLastCalledWith(true);
    expect(screen.findByTestId('ip-waiting-detail-question')?.props.style).toEqual(expect.objectContaining({ display: 'none' }));
    await pressTestInstanceAsync(toggle());
    expect(screen.findByTestId('ip-waiting-other-question-0')?.props.value).toBe('Keep this answer');
    await pressTestInstanceAsync(screen.findByTestId('ip-waiting-option-question-0-0'));
    await pressTestInstanceAsync(toggle()); await pressTestInstanceAsync(toggle());
    expect(screen.findByTestId('ip-waiting-option-question-0-0')?.props.accessibilityState.selected).toBe(true);
    expect(boundary.answer).not.toHaveBeenCalled(); expect(boundary.allow).not.toHaveBeenCalled();
});

it('R46: identical request ids in different sessions keep independent disclosure and send state', async () => {
    const one = worker('one', 'echo one'); const two = worker('two', 'echo two');
    seed([one, two]); const screen = await renderScreen(<WaitingPanel />);
    const cards = () => screen.tree.root.findAllByProps({ testID: 'ip-waiting-card-shared' }).filter(node => typeof node.type === 'string');
    const row = (index: number) => cards()[index]!;
    const toggle = (index: number) => row(index).findByProps({ testID: 'ip-waiting-toggle-shared' });
    await pressTestInstanceAsync(toggle(0));
    expect(toggle(1).props.accessibilityState.expanded).toBe(false);
    const second = row(1);
    await pressTestInstanceAsync(row(0).findByProps({ testID: 'ip-waiting-allow-shared' }));
    act(() => storage.getState().applySessions([{ ...two, updatedAt: two.updatedAt + 1 }]));
    await pressTestInstanceAsync(second.findByProps({ testID: 'ip-waiting-toggle-shared' }));
    expect(second.findByProps({ testID: 'ip-waiting-allow-shared' }).props.disabled).toBe(false);
    expect(boundary.allow).toHaveBeenCalledExactlyOnceWith('one', 'shared');
});

it.each([
    ['echo original', 'echo changed'],
    ['echo \u202E', 'echo ⟨U+202E⟩'],
])('R46: a captured Allow cannot approve %s replaced before React commits', async (original, replacement) => {
    const session = worker('worker', original); seed([session]);
    const screen = await renderScreen(<WaitingPanel />);
    await pressTestInstanceAsync(screen.findByTestId('ip-waiting-toggle-shared'));
    const allow = screen.findByTestId('ip-waiting-allow-shared')!.props.onPress;
    await act(async () => {
        storage.getState().applySessions([{ ...worker('worker', replacement), agentStateVersion: session.agentStateVersion + 1 }]);
        allow();
    });
    expect(boundary.allow).not.toHaveBeenCalled();
    expect(screen.findByTestId('ip-waiting-changed-shared')?.props.accessibilityRole).toBe('alert');
    expect(screen.findByTestId('ip-waiting-toggle-shared')?.props.accessibilityState.expanded).toBe(false);
    // Even a captured action from the new render cannot bypass the fresh disclosure.
    await pressTestInstanceAsync(screen.findByTestId('ip-waiting-allow-shared'));
    expect(boundary.allow).not.toHaveBeenCalled();
    await pressTestInstanceAsync(screen.findByTestId('ip-waiting-toggle-shared'));
    expect(screen.getTextContent()).toContain(replacement);
    await pressTestInstanceAsync(screen.findByTestId('ip-waiting-allow-shared'));
    expect(boundary.allow).toHaveBeenCalledExactlyOnceWith('worker', 'shared');
});

it('equivalent reordered raw desk content requires reinspection before Allow', async () => {
    const session = worker('worker', 'echo same');
    const input = { command: 'echo same', options: { cwd: '/work', env: { FIRST: '1', SECOND: '2' } } };
    session.agentState!.requests!.shared.arguments = input;
    seed([session]);
    const screen = await renderScreen(<WaitingPanel />);
    await pressTestInstanceAsync(screen.findByTestId('ip-waiting-toggle-shared'));
    const retained = screen.findByTestId('ip-waiting-allow-shared')!.props.onPress;
    await act(async () => {
        storage.getState().applySessions([{ ...session, agentStateVersion: session.agentStateVersion + 1,
            agentState: { requests: { shared: { ...session.agentState!.requests!.shared,
                arguments: { options: { env: { SECOND: '2', FIRST: '1' }, cwd: '/work' }, command: 'echo same' } } } } }]);
        await retained();
    });
    expect(boundary.allow).not.toHaveBeenCalled();
    expect(screen.findByTestId('ip-waiting-toggle-shared')?.props.accessibilityState.expanded).toBe(false);
    await pressTestInstanceAsync(screen.findByTestId('ip-waiting-toggle-shared'));
    await pressTestInstanceAsync(screen.findByTestId('ip-waiting-allow-shared'));
    expect(boundary.allow).toHaveBeenCalledExactlyOnceWith('worker', 'shared');
});

it('escapes the Allow label but requires a fresh review when raw and escaped tool names collide', async () => {
    const original = worker('worker', 'echo ready', 'Read\u202E');
    seed([original]);
    const screen = await renderScreen(<WaitingPanel />);
    await pressTestInstanceAsync(screen.findByTestId('ip-waiting-toggle-shared'));
    const label = t('ignorePrevious.allow', { tool: 'Read⟨U+202E⟩' });
    const allow = screen.findByTestId('ip-waiting-allow-shared')!;
    expect(allow.props.accessibilityLabel).toBe(label);
    expect(screen.getTextContent()).toContain(label);
    expect(screen.getTextContent()).not.toContain('\u202E');
    const captured = allow.props.onPress;
    await act(async () => {
        storage.getState().applySessions([{
            ...worker('worker', 'echo ready', 'Read⟨U+202E⟩'), agentStateVersion: original.agentStateVersion + 1,
        }]);
        captured();
    });
    expect(boundary.allow).not.toHaveBeenCalled();
    expect(screen.findByTestId('ip-waiting-changed-shared')).not.toBeNull();
    expect(screen.findByTestId('ip-waiting-toggle-shared')?.props.accessibilityState.expanded).toBe(false);
    await pressTestInstanceAsync(screen.findByTestId('ip-waiting-toggle-shared'));
    await pressTestInstanceAsync(screen.findByTestId('ip-waiting-allow-shared'));
    expect(boundary.allow).toHaveBeenCalledExactlyOnceWith('worker', 'shared');
});

it('keeps a question draft with its request through reorder, collapse, reconnect and a retained-data readiness dip', async () => {
    const question = createSessionFixture({ id: 'draft', active: true, agentState: { requests: {
        question: { tool: 'AskUserQuestion', kind: 'user_action', arguments: { questions: [{
            question: 'Which checks?', options: [{ label: 'Unit' }], multiSelect: true,
        }, { question: 'Any notes?', freeform: {} }] }, createdAt: 2 },
    } } });
    const other = worker('other', 'echo other'); seed([question, other]);
    const dirty = vi.fn(); const screen = await renderScreen(<WaitingPanel onDirtyChange={dirty} />);
    await pressTestInstanceAsync(screen.findByTestId('ip-waiting-toggle-question'));
    await pressTestInstanceAsync(screen.findByTestId('ip-waiting-option-question-0-0'));
    act(() => screen.tree.changeTextByTestId('ip-waiting-other-question-1', 'Keep my draft'));
    await pressTestInstanceAsync(screen.findByTestId('ip-waiting-toggle-question'));
    act(() => storage.getState().applySessions([{ ...other, agentStateVersion: 2, agentState: { requests: {
        shared: { tool: 'Bash', arguments: { command: 'echo other' }, createdAt: 3 },
    } } }]));
    act(() => { storage.getState().setSocketStatus('connecting'); storage.setState({ isDataReady: false }); });
    expect(dirty).toHaveBeenLastCalledWith(true);
    await pressTestInstanceAsync(screen.findByTestId('ip-waiting-toggle-question'));
    expect(screen.findByTestId('ip-waiting-send-question')?.props.disabled).toBe(true);
    expect(screen.findByTestId('ip-waiting-other-question-1')?.props.value).toBe('Keep my draft');
    act(() => { storage.getState().setSocketStatus('connected'); storage.getState().applyReady(); });
    expect(screen.findByTestId('ip-waiting-option-question-0-0')?.props.accessibilityState.selected).toBe(true);
    expect(screen.findByTestId('ip-waiting-other-question-1')?.props.value).toBe('Keep my draft');
    expect(boundary.answer).not.toHaveBeenCalled();
    // Real server resets clear records as well as readiness. Never bring those requests back.
    act(() => storage.setState({ sessions: {}, sessionListRenderables: {}, isDataReady: false }));
    expect(screen.findByTestId('ip-waiting-toggle-question')).toBeNull();
    act(() => storage.getState().applyReady());
    expect(screen.findByTestId('ip-waiting-toggle-question')).toBeNull();
});

it.each(['permission_request_not_found', 'permission_request_expired'])('never retries a request rejected as %s after collapse or a readiness dip', async errorCode => {
    boundary.allow.mockResolvedValue({ ok: false, errorCode }); seed([worker('worker', 'echo expired')]);
    const history = createWaitingHistory();
    const screen = await renderScreen(<WaitingPanel history={history} />);
    const toggle = () => screen.findByTestId('ip-waiting-toggle-shared');
    await pressTestInstanceAsync(toggle());
    await pressTestInstanceAsync(screen.findByTestId('ip-waiting-allow-shared'));
    await pressTestInstanceAsync(toggle());
    act(() => storage.setState({ isDataReady: false }));
    act(() => storage.getState().applyReady());
    await pressTestInstanceAsync(toggle());
    expect(screen.findByTestId('ip-waiting-allow-shared')?.props.disabled).toBe(true);
    await pressTestInstanceAsync(screen.findByTestId('ip-waiting-allow-shared'));
    expect(boundary.allow).toHaveBeenCalledTimes(1);
    act(() => screen.tree.unmount());
    const reopened = await renderScreen(<WaitingPanel history={history} />);
    await pressTestInstanceAsync(reopened.findByTestId('ip-waiting-toggle-shared'));
    expect(reopened.findByTestId('ip-waiting-allow-shared')?.props.disabled).toBe(true);
    await pressTestInstanceAsync(reopened.findByTestId('ip-waiting-allow-shared'));
    expect(boundary.allow).toHaveBeenCalledTimes(1);
});

it('requires a fresh review and permits exactly one answer to a cwd-only replacement after success, including drawer reopen', async () => {
    const version = (cwd: string, agentStateVersion: number) => createSessionFixture({
        ...worker('worker', 'echo check'), agentStateVersion,
        agentState: { requests: { shared: { tool: 'Bash', arguments: { command: 'echo check', cwd }, createdAt: 1 } } },
    });
    seed([version('/work/first', 1)]);
    const history = createWaitingHistory();
    const screen = await renderScreen(<WaitingPanel history={history} />);
    await pressTestInstanceAsync(screen.findByTestId('ip-waiting-toggle-shared'));
    await pressTestInstanceAsync(screen.findByTestId('ip-waiting-allow-shared'));
    act(() => storage.getState().applySessions([version('/work/second', 2)]));
    expect(screen.findByTestId('ip-waiting-changed-shared')).not.toBeNull();
    expect(screen.findByTestId('ip-waiting-toggle-shared')?.props.accessibilityState.expanded).toBe(false);
    await pressTestInstanceAsync(screen.findByTestId('ip-waiting-toggle-shared'));
    expect(screen.getTextContent()).toContain('/work/second');
    expect(screen.findByTestId('ip-waiting-allow-shared')?.props.disabled).toBe(false);
    act(() => screen.tree.unmount());
    const reopened = await renderScreen(<WaitingPanel history={history} />);
    await pressTestInstanceAsync(reopened.findByTestId('ip-waiting-toggle-shared'));
    expect(reopened.findByTestId('ip-waiting-allow-shared')?.props.disabled).toBe(false);
    const allow = reopened.findByTestId('ip-waiting-allow-shared')!.props.onPress;
    await act(async () => { allow(); allow(); });
    expect(boundary.allow).toHaveBeenCalledTimes(2);
    act(() => reopened.tree.unmount());
    const settled = await renderScreen(<WaitingPanel history={history} />);
    await pressTestInstanceAsync(settled.findByTestId('ip-waiting-toggle-shared'));
    expect(settled.findByTestId('ip-waiting-allow-shared')?.props.disabled).toBe(true);
});

it.each(['success', 'permission_request_expired', 'permission_request_not_found', 'failure'] as const)(
    'isolates a pending version from its replacement when the old completion is %s', async completion => {
        const pending = createDeferred<SessionPermissionResult>();
        boundary.allow.mockReturnValueOnce(pending.promise);
        const sessionId = `worker-${completion}`;
        const original = worker(sessionId, 'echo \u202E'); seed([original]);
        const history = createWaitingHistory();
        const screen = await renderScreen(<WaitingPanel history={history} />);
        await pressTestInstanceAsync(screen.findByTestId('ip-waiting-toggle-shared'));
        const staleAllow = screen.findByTestId('ip-waiting-allow-shared')!.props.onPress;
        act(() => { staleAllow(); staleAllow(); });
        expect(boundary.allow).toHaveBeenCalledTimes(1);
        // Commit and explicitly review B before completing A. The display text collides,
        // but the raw request differs. A's transport lock remains until A actually completes.
        act(() => storage.getState().applySessions([{ ...worker(sessionId, 'echo ⟨U+202E⟩'), agentStateVersion: original.agentStateVersion + 1 }]));
        expect(screen.findByTestId('ip-waiting-changed-shared')).not.toBeNull();
        await pressTestInstanceAsync(screen.findByTestId('ip-waiting-toggle-shared'));
        expect(screen.findByTestId('ip-waiting-allow-shared')?.props.disabled).toBe(true);
        await pressTestInstanceAsync(screen.findByTestId('ip-waiting-allow-shared'));
        expect(boundary.allow).toHaveBeenCalledTimes(1);
        await act(async () => {
            if (completion === 'failure') pending.reject(new Error('offline'));
            else pending.resolve(completion === 'success' ? { ok: true } : {
                ok: false, errorCode: completion, errorMessage: completion, requestId: 'shared',
            });
        });
        expect(screen.findByTestId('ip-waiting-allow-shared')?.props.disabled).toBe(true);
        // A callback captured from A cannot dispatch an answer for B after A releases its lock.
        await act(async () => { staleAllow(); });
        expect(boundary.allow).toHaveBeenCalledTimes(1);
        act(() => screen.tree.unmount());
        const reopened = await renderScreen(<WaitingPanel history={history} />);
        await pressTestInstanceAsync(reopened.findByTestId('ip-waiting-toggle-shared'));
        expect(reopened.findByTestId('ip-waiting-allow-shared')?.props.disabled).toBe(true);
        const allow = reopened.findByTestId('ip-waiting-allow-shared')!.props.onPress;
        await act(async () => { allow(); allow(); });
        expect(boundary.allow).toHaveBeenCalledTimes(1);
        expect(reopened.findByTestId('ip-waiting-earlier-shared')).not.toBeNull();
    },
);

it.each(['unknown', 'stale', 'fresh'] as const)('keeps %s worker status honest inside disclosure and leaves compact rows quiet', async status => {
    seed([createSessionFixture({ ...worker('worker', 'echo check'), activeAt: status === 'unknown' ? 0 : Date.now() - (status === 'stale' ? 180_000 : 0), thinkingAt: 0,
        agentState: { requests: { shared: { tool: 'Bash', arguments: { command: 'echo unknown' } } } },
        runtimeActivityObservedAt: null, latestTurnStatusObservedAt: null, latestReadyEventAt: null,
        pendingRequestObservedAt: null })]);
    const screen = await renderScreen(<WaitingPanel />);
    expect(screen.findByTestId('ip-waiting-stale-shared')).toBeNull();
    await pressTestInstanceAsync(screen.findByTestId('ip-waiting-toggle-shared'));
    if (status === 'fresh') expect(screen.findByTestId('ip-waiting-stale-shared')).toBeNull();
    else expect(screen.getTextContent()).toContain(t(status === 'unknown' ? 'ignorePrevious.waiting.workerUnknown' : 'ignorePrevious.connection.staleRequest'));
    expect(screen.findByTestId('ip-waiting-allow-shared')?.props.disabled).toBe(false);
    expect(screen.findByTestId('ip-waiting-deny-shared')?.props.disabled).toBe(false);
});

it('requires a fresh look at an edit changed at the same file path', async () => {
    const edit = (body: string) => createSessionFixture({ id: 'editor', active: true, agentStateVersion: body === 'old text' ? 1 : 2,
        agentState: { requests: { edit: { tool: 'Write', arguments: { file_path: 'notes.txt', content: body }, createdAt: 1 } } } });
    seed([edit('old text')]); const screen = await renderScreen(<WaitingPanel />);
    await pressTestInstanceAsync(screen.findByTestId('ip-waiting-toggle-edit'));
    const allow = screen.findByTestId('ip-waiting-allow-edit')!.props.onPress;
    await act(async () => { storage.getState().applySessions([edit('different text')]); allow(); });
    expect(boundary.allow).not.toHaveBeenCalled();
    expect(screen.findByTestId('ip-waiting-changed-edit')).not.toBeNull();
    await pressTestInstanceAsync(screen.findByTestId('ip-waiting-toggle-edit'));
    expect(screen.getTextContent()).toContain('different text');
    await pressTestInstanceAsync(screen.findByTestId('ip-waiting-allow-edit'));
    expect(boundary.allow).toHaveBeenCalledExactlyOnceWith('editor', 'edit');
});
