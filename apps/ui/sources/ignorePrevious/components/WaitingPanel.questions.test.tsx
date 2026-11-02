import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { renderScreen, pressTestInstanceAsync, createSessionFixture, createDeferred } from '@/dev/testkit';
import { storage } from '@/sync/domains/state/storage';
import type { Session } from '@/sync/domains/state/storageTypes';
import { buildAskUserQuestionAnswerPayload } from '@/components/tools/renderers/workflow/buildAskUserQuestionAnswerPayload';
import { setCoordinatorOverride } from '../deskPrefs';
import { WaitingPanel } from './WaitingPanel';
import { t } from '@/text';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const boundary = vi.hoisted(() => ({ answer: vi.fn(), allow: vi.fn(), deny: vi.fn(), alert: vi.fn() }));
// Answers leave the component through the existing operation boundary. Store and payload logic stay real.
vi.mock('@/sync/ops', () => ({ sessionAllowWithAnswers: boundary.answer, sessionAllowResult: boundary.allow, sessionDenyResult: boundary.deny }));
vi.mock('@/sync/sync', async () => {
    const { installSyncStub } = await import('@/dev/testkit/mocks/sync');
    return installSyncStub()();
});
vi.mock('@react-navigation/native', async () => {
    const { createReactNavigationNativeMock } = await import('@/dev/testkit/mocks/reactNavigation');
    return createReactNavigationNativeMock();
});
vi.mock('@expo/vector-icons', async () => {
    const { createExpoVectorIconsMock } = await import('@/dev/testkit/mocks/icons');
    return createExpoVectorIconsMock();
});
vi.mock('expo-router', async () => {
    const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
    return createExpoRouterMock().module;
});
vi.mock('@/modal', async () => {
    const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
    return createModalModuleMock({ spies: { alert: boundary.alert } }).module;
});

const question = { header: 'Version', question: 'Which release?', options: [
    { label: 'Stable', value: 'stable-id', description: 'Use the shipped release' },
    { label: 'Preview', choice: 'preview-id', description: 'Try the preview' },
], multiSelect: false };
const multi = { header: 'Checks', question: 'Which checks?', options: [
    { label: 'Unit', description: 'Run unit tests' }, { label: 'Types', description: 'Check types' },
], multiSelect: true, freeform: {} };
let previous: ReturnType<typeof storage.getState>;
function worker(input: unknown = { questions: [question] }, request: Record<string, unknown> = {}, supported = true): Session {
    return createSessionFixture({ id: 'worker', active: true, agentState: {
        capabilities: { structuredQuestionAnswersV1Supported: supported },
        requests: { request: { tool: 'AskUserQuestion', kind: 'user_action', arguments: input, createdAt: 1, ...request } },
    } as Session['agentState'] });
}
function seed(session = worker()) {
    act(() => {
        storage.getState().setSocketStatus('connected');
        storage.getState().applySessions([session]);
        storage.getState().applyReady();
    });
    return session;
}
const sendId = 'ip-waiting-send-request';
const optionId = (q = 0, o = 0) => `ip-waiting-option-request-${q}-${o}`;
const otherId = (q = 0) => `ip-waiting-other-request-${q}`;
async function render(onDirtyChange?: (dirty: boolean) => void) { return renderScreen(<WaitingPanel onDirtyChange={onDirtyChange} />); }
type Screen = Awaited<ReturnType<typeof render>>;
async function pick(screen: Screen, q = 0, o = 0) { await pressTestInstanceAsync(screen.findByTestId(optionId(q, o)), 'question option'); }
async function send(screen: Screen) { await pressTestInstanceAsync(screen.findByTestId(sendId), 'Send'); }
function expectedPayload(questions: Parameters<typeof buildAskUserQuestionAnswerPayload>[0]['questions'], selections: Map<number, Set<number>>, freeformAnswers = new Map<number, string>(), supported = true) {
    const payload = buildAskUserQuestionAnswerPayload({ questions, selections, freeformAnswers, structuredQuestionAnswersV1Supported: supported });
    if (payload.kind === 'requires_cli_update') throw new Error('Fixture must be sendable');
    return payload.send;
}

beforeEach(() => {
    previous = storage.getState();
    boundary.answer.mockReset().mockResolvedValue(undefined);
    boundary.allow.mockReset().mockResolvedValue({ ok: true });
    boundary.deny.mockReset().mockResolvedValue({ ok: true });
    boundary.alert.mockReset();
});
afterEach(() => { act(() => { setCoordinatorOverride(null); storage.setState(previous, true); }); });

describe('Waiting worker questions', () => {
    it('W5: shows questions and options; picking never sends; explicit Send uses the builder', async () => {
        seed(); const screen = await render();
        expect(screen.getTextContent()).toContain(question.question);
        expect(screen.getTextContent()).toContain(question.options[0]!.description);
        expect(screen.findByTestId(sendId)?.props.disabled).toBe(true);
        await send(screen); expect(boundary.answer).not.toHaveBeenCalled();
        await pick(screen); expect(boundary.answer).not.toHaveBeenCalled();
        expect(screen.findByTestId(optionId())?.props.accessibilityState.selected).toBe(true);
        expect(screen.findByTestId(sendId)?.props.disabled).toBe(false);
        await pick(screen, 0, 1);
        expect(screen.findByTestId(optionId())?.props.accessibilityState.selected).toBe(false);
        await send(screen);
        expect(boundary.answer).toHaveBeenCalledExactlyOnceWith('worker', 'request', expectedPayload([question], new Map([[0, new Set([1])]])));
        expect(boundary.allow).not.toHaveBeenCalled(); expect(boundary.deny).not.toHaveBeenCalled();
    });

    it('W5: requires both questions, supports multiple picks and toggle off', async () => {
        seed(worker({ questions: [question, multi] })); const screen = await render();
        await pick(screen); expect(screen.findByTestId(sendId)?.props.disabled).toBe(true);
        await pick(screen, 1, 0); await pick(screen, 1, 1); await pick(screen, 1, 0);
        expect(screen.findByTestId(optionId(1, 0))?.props.accessibilityState.selected).toBe(false);
        await pick(screen, 1, 0); await send(screen);
        expect(boundary.answer).toHaveBeenCalledExactlyOnceWith('worker', 'request', expectedPayload([question, multi], new Map([[0, new Set([0])], [1, new Set([1, 0])]])));
    });

    it('W5: Other text replaces picks and a later pick replaces Other text', async () => {
        seed(worker({ questions: [multi] })); const screen = await render();
        await pick(screen);
        act(() => screen.tree.changeTextByTestId(otherId(), '  custom, check  '));
        expect(screen.findByTestId(optionId())?.props.accessibilityState.selected).toBe(false);
        expect(boundary.answer).not.toHaveBeenCalled();
        await pick(screen, 0, 1); expect(screen.findByTestId(otherId())?.props.value).toBe('');
        act(() => screen.tree.changeTextByTestId(otherId(), '  custom, check  '));
        await send(screen);
        expect(boundary.answer).toHaveBeenCalledExactlyOnceWith('worker', 'request', expectedPayload([multi], new Map(), new Map([[0, '  custom, check  ']])));
    });

    it('W5: double press sends once, locks editing and clears dirty only after success', async () => {
        const gate = createDeferred<void>(); boundary.answer.mockReturnValue(gate.promise);
        seed(); const dirty = vi.fn(); const screen = await render(dirty); await pick(screen);
        expect(dirty).toHaveBeenLastCalledWith(true);
        const press = screen.findByTestId(sendId)!.props.onPress;
        await act(async () => { press(); press(); });
        expect(boundary.answer).toHaveBeenCalledTimes(1);
        expect(screen.findByTestId(sendId)?.props.accessibilityState).toMatchObject({ disabled: true, busy: true });
        expect(screen.findByTestId(optionId())?.props.disabled).toBe(true);
        expect(dirty).toHaveBeenLastCalledWith(true);
        await act(async () => gate.resolve());
        expect(dirty).toHaveBeenLastCalledWith(false);
        await send(screen); expect(boundary.answer).toHaveBeenCalledTimes(1);
    });

    it('W5: failure preserves selections and text, reports an inline error and permits retry', async () => {
        boundary.answer.mockRejectedValueOnce(new Error('offline'));
        seed(worker({ questions: [question, multi] })); const dirty = vi.fn(); const screen = await render(dirty);
        await pick(screen); act(() => screen.tree.changeTextByTestId(otherId(1), 'custom check'));
        await send(screen);
        expect(screen.findByTestId('ip-waiting-card-request')).not.toBeNull();
        expect(screen.findByTestId(optionId())?.props.accessibilityState.selected).toBe(true);
        expect(screen.findByTestId(otherId(1))?.props.value).toBe('custom check');
        expect(screen.findByTestId('ip-waiting-question-error-request')).not.toBeNull();
        expect(screen.getTextContent()).toContain(t('ignorePrevious.waiting.answerFailed'));
        expect(dirty).toHaveBeenLastCalledWith(true);
        expect(screen.findByTestId(sendId)?.props.disabled).toBe(false);
        await send(screen); expect(boundary.answer).toHaveBeenCalledTimes(2);
        expect(dirty).toHaveBeenLastCalledWith(false);
    });

    it.each(['permission_request_not_found', 'permission_request_expired'])('W5: %s uses the existing already-answered path', async (errorCode) => {
        boundary.answer.mockRejectedValueOnce({ errorCode }); seed(); const screen = await render();
        await pick(screen); await send(screen);
        expect(boundary.alert).toHaveBeenCalledWith(t('ignorePrevious.waiting.alreadyAnsweredTitle'), t('ignorePrevious.waiting.alreadyAnswered'));
    });

    it('W5: uses legacy payloads only when supported by the builder', async () => {
        seed(worker({ questions: [question] }, {}, false)); const screen = await render(); await pick(screen); await send(screen);
        expect(boundary.answer).toHaveBeenCalledExactlyOnceWith('worker', 'request', expectedPayload([question], new Map([[0, new Set([0])]]), new Map(), false));
    });

    it('W5: a modern-only answer stays unsent on an older CLI, including capability loss before pressing Send', async () => {
        const ambiguous = { ...question, options: [{ label: 'one, two' }] };
        const session = seed(worker({ questions: [ambiguous] })); const screen = await render(); await pick(screen);
        act(() => storage.getState().applySessions([{ ...session, agentStateVersion: 2, agentState: worker({ questions: [ambiguous] }, {}, false).agentState }]));
        expect(screen.findByTestId(sendId)?.props.disabled).toBe(true);
        expect(screen.getTextContent()).toContain(t('deps.ui.notAvailableUpdateCli'));
        await send(screen); expect(boundary.answer).not.toHaveBeenCalled();
    });

    it('J9 W5: answering and the request disappearing removes the active card and clears dirty', async () => {
        const session = seed(); const dirty = vi.fn(); const screen = await render(dirty); await pick(screen); await send(screen);
        act(() => storage.getState().applySessions([{ ...session, agentStateVersion: 2, agentState: { requests: {} } }]));
        expect(screen.findByTestId('ip-waiting-card-request')).toBeNull();
        expect(screen.findByTestId('ip-answered-request')).not.toBeNull();
        expect(dirty).toHaveBeenLastCalledWith(false);
    });

    it('W5: an unanswered disappearing request clears a typed draft', async () => {
        const session = seed(worker({ questions: [{ ...multi, options: [] }] })); const dirty = vi.fn(); const screen = await render(dirty);
        act(() => screen.tree.changeTextByTestId(otherId(), ' '));
        expect(dirty).toHaveBeenLastCalledWith(true); expect(screen.findByTestId(sendId)?.props.disabled).toBe(true);
        act(() => storage.getState().applySessions([{ ...session, agentStateVersion: 2, agentState: { requests: {} } }]));
        expect(dirty).toHaveBeenLastCalledWith(false);
    });

    it.each([
        ['ExitPlanMode', { tool: 'ExitPlanMode' }, { questions: [question] }],
        ['plain approval', { tool: 'Bash', kind: 'permission' }, { command: 'test' }],
        ['attached terminal', { source: 'claude_unified_terminal_dialog_choice' }, { questions: [question] }],
        ['dialog envelope', {}, { questions: [question], happierDialog: { kind: 'unrecognized', mode: 'notice', dialogId: 'unrecognized_confirmation', action: 'open_terminal' } }],
        ['malformed question', {}, { questions: [null] }],
    ])('W5: %s keeps the existing actions', async (_name, request, input) => {
        seed(worker(input, request)); const screen = await render();
        expect(screen.findByTestId(sendId)).toBeNull(); expect(screen.findByTestId(optionId())).toBeNull();
        if ('tool' in request && request.tool === 'Bash') { expect(screen.findByTestId('ip-waiting-allow-request')).not.toBeNull(); expect(screen.findByTestId('ip-waiting-deny-request')).not.toBeNull(); }
        else expect(screen.getTextContent()).toContain(t('ignorePrevious.openSession'));
    });

    it('W5: coordinator questions and view-only worker questions cannot send from Waiting', async () => {
        seed(); act(() => setCoordinatorOverride('worker')); const screen = await render();
        expect(screen.findByTestId(sendId)).toBeNull();
        act(() => { setCoordinatorOverride(null); storage.getState().applySessions([{ ...worker(), accessLevel: 'view' }]); });
        expect(screen.findByTestId(sendId)).toBeNull();
        expect(boundary.answer).not.toHaveBeenCalled();
    });
});
