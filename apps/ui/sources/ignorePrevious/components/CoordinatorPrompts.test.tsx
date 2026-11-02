import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, Profiler, type ProfilerOnRenderCallback } from 'react';
import { readComposerText, registerComposerRequestHandle } from '@/components/sessions/model/composerRequests';
import { t } from '@/text';
import { renderScreen } from '@/dev/testkit';
import { createSessionFixture } from '@/dev/testkit/fixtures/sessionFixtures';
import { buildSessionListRenderableFromSession } from '@/sync/domains/session/listing/sessionListRenderable';
import { storage } from '@/sync/domains/state/storage';
import type { Session } from '@/sync/domains/state/storageTypes';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

/** Loads sessions into the real store the way the first sync does: list rows and full records. */
function seed(sessions: Session[]) {
    act(() => {
        storage.getState().applySessions(sessions);
        storage.getState().applyReady();
    });
}

const state = vi.hoisted(() => ({
    submit: vi.fn(async (..._args: unknown[]) => undefined),
    answer: vi.fn(),
    allow: vi.fn(),
    deny: vi.fn(),
    alert: vi.fn(),
}));

// Permission and structured-answer RPCs must never be reached by a draft chip.
vi.mock('@/sync/ops', () => ({
    sessionAllowWithAnswers: state.answer,
    sessionAllow: state.allow,
    sessionAllowResult: state.allow,
    sessionDeny: state.deny,
    sessionDenyResult: state.deny,
}));

vi.mock('@expo/vector-icons', async () => {
    const { createExpoVectorIconsMock } = await import('@/dev/testkit/mocks/icons');
    return createExpoVectorIconsMock();
});

// The network send is the boundary.
vi.mock('@/sync/sync', async () => {
    const { installSyncStub } = await import('@/dev/testkit/mocks/sync');
    return installSyncStub({ submitMessage: (...args: unknown[]) => state.submit(...args) } as never)();
});

vi.mock('@/modal', async () => {
    const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
    return createModalModuleMock({ spies: { alert: state.alert } }).module;
});

function session(id: string, request: Record<string, unknown> | null): Session {
    return createSessionFixture({
        id,
        active: true,
        metadata: { path: '/workspace/project', host: 'h', homeDir: '/workspace', machineId: 'm', summary: { text: `Title ${id}`, updatedAt: 1 } } as Session['metadata'],
        agentState: request ? ({ requests: { r1: request } } as unknown as Session['agentState']) : null,
    });
}

async function renderPrompts(onRender?: ProfilerOnRenderCallback) {
    const { CoordinatorPrompts } = await import('./CoordinatorPrompts');
    if (onRender) return renderScreen(<Profiler id="prompts" onRender={onRender}><CoordinatorPrompts coordinatorId="coord" /></Profiler>);
    return renderScreen(<CoordinatorPrompts coordinatorId="coord" />);
}

const pendingQuestion = {
    tool: 'AskUserQuestion', kind: 'user_action', createdAt: 1,
    arguments: { questions: [{ question: 'Which release?', multiSelect: false, options: [
        { label: 'Stable', value: 'stable-id' }, { label: 'Preview', choice: 'preview-id' },
    ] }] },
};

describe('CoordinatorPrompts', () => {
    let previous: ReturnType<typeof storage.getState>;
    let unregister: () => void;
    let focused = false;
    afterEach(() => {
        unregister();
        act(() => {
            storage.setState(previous, true);
        });
        expect(state.submit).not.toHaveBeenCalled();
        expect(state.answer).not.toHaveBeenCalled();
        expect(state.allow).not.toHaveBeenCalled();
        expect(state.deny).not.toHaveBeenCalled();
    });

    beforeEach(() => {
        previous = storage.getState();
        let text = '';
        focused = false;
        unregister = registerComposerRequestHandle('coord', {
            setText: (value) => { text = value; },
            getText: () => text,
            focus: () => { focused = true; },
        });
        state.submit.mockReset().mockResolvedValue(undefined);
        state.answer.mockReset();
        state.allow.mockReset();
        state.deny.mockReset();
        state.alert.mockReset();
    });

    it('C: coordinator question options follow the fixed chips and tap fills after the draft without sending or answering', async () => {
        seed([
            session('coord', pendingQuestion),
            session('worker', { tool: 'Bash', arguments: { command: 'build' }, createdAt: 2 }),
        ]);
        const screen = await renderPrompts();
        const chips = screen.tree.findAll((node) => typeof node.type === 'string' && node.props.accessibilityRole === 'button');
        expect(chips.map((node) => node.props.testID)).toEqual([
            'ip-brief-first', 'ip-start-new', 'ip-walk-waiting', 'ip-walk-prs',
            'ip-coordinator-reply-0', 'ip-coordinator-reply-1',
        ]);
        expect(screen.getTextContent()).toContain('Stable');
        expect(screen.getTextContent()).toContain('Preview');
        expect(screen.findByTestId('ip-coordinator-reply-0')?.props.accessibilityLabel)
            .toBe('Answer to the coordinator\'s question: Stable');
        await screen.pressByTestIdAsync('ip-brief-first');
        await screen.pressByTestIdAsync('ip-coordinator-reply-1');
        expect(readComposerText('coord')).toBe(`${t('ignorePrevious.composer.briefPrompt')}\n\nPreview`);
        expect(focused).toBe(true);
        expect(storage.getState().sessions.coord.agentState?.requests?.r1).toEqual(pendingQuestion);
    });

    it.each(['answered', 'removed'])('C: an %s coordinator request loses its chips through the real store subscription', async (scenario) => {
        seed([session('coord', pendingQuestion)]);
        const screen = await renderPrompts();
        expect(screen.findByTestId('ip-coordinator-reply-0')).not.toBeNull();
        const next = session('coord', null);
        if (scenario === 'answered') next.agentState = {
            requests: {}, completedRequests: { r1: { ...pendingQuestion, status: 'approved', completedAt: 2 } },
        };
        seed([next]);
        expect(screen.findByTestId('ip-coordinator-reply-0')).toBeNull();
        expect(screen.findByTestId('ip-coordinator-reply-1')).toBeNull();
    });

    it.each([false, true])('C: no coordinator question shows only fixed chips, worker question pending = %s', async (workerPending) => {
        seed([session('coord', null), ...(workerPending ? [session('worker', pendingQuestion)] : [])]);
        const screen = await renderPrompts();
        const chips = screen.tree.findAll((node) => typeof node.type === 'string' && node.props.accessibilityRole === 'button');
        expect(chips.map((node) => node.props.testID)).toEqual([
            'ip-brief-first', 'ip-start-new', ...(workerPending ? ['ip-walk-waiting'] : []), 'ip-walk-prs',
        ]);
    });

    it('C: new questions and changed labels arrive live; unrelated state and equivalent labels do not render the row', async () => {
        seed([session('coord', null)]);
        const onRender = vi.fn<ProfilerOnRenderCallback>();
        const screen = await renderPrompts(onRender);
        expect(screen.findByTestId('ip-coordinator-reply-0')).toBeNull();
        seed([session('coord', pendingQuestion)]);
        expect(screen.findByTestId('ip-coordinator-reply-0')).not.toBeNull();
        const renderCount = onRender.mock.calls.length;
        act(() => storage.getState().setSocketStatus('connected'));
        seed([session('coord', { ...pendingQuestion, createdAt: 2 })]);
        expect(onRender.mock.calls).toHaveLength(renderCount);
        seed([session('coord', {
            ...pendingQuestion, arguments: { questions: [{ question: 'Which release?', multiSelect: false, options: [{ label: 'Next release' }] }] },
        })]);
        expect(screen.getTextContent()).toContain('Next release');
        expect(screen.getTextContent()).not.toContain('Stable');
        await screen.pressByTestIdAsync('ip-coordinator-reply-0');
        expect(readComposerText('coord')).toBe('Next release');
        expect(focused).toBe(true);
    });

    it('J1: offers the four drafts in order with the current waiting count', async () => {
        seed([
            session('coord', null),
            session('s1', { tool: 'Bash', arguments: { command: 'build' }, createdAt: 10 }),
        ]);
        const screen = await renderPrompts();
        const chips = screen.tree.findAll((node) => typeof node.type === 'string' && node.props.accessibilityRole === 'button');
        expect(chips.map((node) => node.props.testID)).toEqual(['ip-brief-first', 'ip-start-new', 'ip-walk-waiting', 'ip-walk-prs']);
        expect(screen.getTextContent()).toContain("Go through what's waiting (1)");
    });

    it.each([
        ['J1', 'ip-brief-first', 'The six questions: aim, agreed, checked, happening, your turn, left.'],
        ['J4 start', 'ip-start-new', 'Plan a new issue together before anyone starts.'],
    ])('%s: a chip fills and focuses the coordinator composer without sending', async (_journey, id, prompt) => {
        seed([session('coord', null)]);
        const screen = await renderPrompts();
        await screen.pressByTestIdAsync(id);
        expect(readComposerText('coord')).toBe(prompt);
        expect(focused).toBe(true);
    });

    it('M1: a chip keeps a typed draft and adds its prompt after a blank line', async () => {
        seed([session('coord', null)]);
        const screen = await renderPrompts();
        await screen.pressByTestIdAsync('ip-walk-prs');
        // The first chip leaves text in the box, standing in for a typed draft.
        await screen.pressByTestIdAsync('ip-start-new');
        expect(readComposerText('coord')).toBe(`${t('ignorePrevious.walkPrsPrompt')}\n\nPlan a new issue together before anyone starts.`);
        expect(focused).toBe(true);
    });

    it('M1: a whitespace-only draft is replaced, not appended to', async () => {
        seed([session('coord', null)]);
        const screen = await renderPrompts();
        unregister();
        let text = '  \n ';
        unregister = registerComposerRequestHandle('coord', {
            setText: (value) => { text = value; },
            getText: () => text,
            focus: () => { focused = true; },
        });
        await screen.pressByTestIdAsync('ip-start-new');
        expect(readComposerText('coord')).toBe('Plan a new issue together before anyone starts.');
    });

    it('J1: fills the composer to ask the coordinator to go through every waiting request, with what each one runs', async () => {
        seed([
            session('coord', null),
            session('s1', { tool: 'Bash', arguments: { command: 'rm -rf build', description: 'Clean the build' }, createdAt: 10 }),
            session('s2', { tool: 'Edit', arguments: { file_path: '/workspace/project/a.ts' }, createdAt: 20 }),
        ]);
        const screen = await renderPrompts();
        await screen.pressByTestIdAsync('ip-walk-waiting');

        const text = readComposerText('coord');
        expect(focused).toBe(true);
        expect(text).toContain('rm -rf build');
        expect(text).toContain('Clean the build');
        expect(text).toContain('/workspace/project/a.ts');
        expect(text).toContain('s1');
        expect(text).toContain('Title s2');
    });

    it('L2: the walk-through includes worker requests but never its own coordinator request', async () => {
        seed([
            session('coord', { tool: 'Bash', arguments: { command: 'coordinator-command' }, createdAt: 10 }),
            session('s1', { tool: 'Bash', arguments: { command: 'worker-command' }, createdAt: 20 }),
        ]);
        const screen = await renderPrompts();
        await screen.pressByTestIdAsync('ip-walk-waiting');
        const text = String(readComposerText('coord'));
        expect(text).toContain('worker-command');
        expect(text).not.toContain('coordinator-command');
        expect(text).not.toContain('Title coord');
    });

    it('L2: no walk-through when only the coordinator waits', async () => {
        seed([session('coord', { tool: 'Bash', arguments: { command: 'coordinator-command' }, createdAt: 10 })]);
        const screen = await renderPrompts();
        expect(screen.findByTestId('ip-walk-waiting')).toBeNull();
    });

    it('L2: an unloaded coordinator request is also excluded from the walk-through', async () => {
        seed([{ ...session('coord', null), pendingPermissionRequestCount: 1, pendingRequestObservedAt: Date.now() }]);
        const screen = await renderPrompts();
        expect(screen.findByTestId('ip-walk-waiting')).toBeNull();
    });

    it('tells the coordinator which waiting sessions the desk could not read, apart from ones not loaded yet', async () => {
        seed([session('coord', null)]);
        // Two sidebar rows with a pending request and no full record: one unreadable, one not loaded yet.
        const unreadable = buildSessionListRenderableFromSession(
            createSessionFixture({ id: 'u1', active: true, pendingPermissionRequestCount: 1, pendingRequestObservedAt: Date.now() }),
        );
        const notLoaded = buildSessionListRenderableFromSession(
            createSessionFixture({ id: 'n1', active: true, pendingPermissionRequestCount: 1, pendingRequestObservedAt: Date.now() }),
        );
        act(() => {
            storage.getState().mergeSessionListRenderables([{ ...unreadable, metadata: null, metadataUnavailable: true }, notLoaded]);
        });
        const screen = await renderPrompts();
        await screen.pressByTestIdAsync('ip-walk-waiting');

        const lines = String(readComposerText('coord')).split('\n');
        const u1 = lines.find((line) => line.includes('session u1'));
        const n1 = lines.find((line) => line.includes('session n1'));
        expect(u1).toBeDefined();
        expect(n1).toBeDefined();
        expect(u1).not.toContain("aren't loaded");
        expect(n1).toContain("aren't loaded");
    });

    it('L2: an unreadable coordinator is excluded from the chip and unreadable lines', async () => {
        seed([]);
        const unreadable = buildSessionListRenderableFromSession(
            createSessionFixture({ id: 'coord', active: true, pendingPermissionRequestCount: 1, pendingRequestObservedAt: Date.now() }),
        );
        act(() => {
            storage.getState().mergeSessionListRenderables([{ ...unreadable, metadata: null, metadataUnavailable: true }]);
        });
        const screen = await renderPrompts();
        expect(screen.findByTestId('ip-walk-waiting')).toBeNull();

        // A worker makes the walk-through available without changing the unreadable coordinator row.
        seed([session('s1', { tool: 'Bash', arguments: { command: 'worker-command' }, createdAt: 20 })]);
        await screen.pressByTestIdAsync('ip-walk-waiting');
        const text = String(readComposerText('coord'));
        expect(text).toContain('worker-command');
        expect(text).not.toContain('session coord');
    });

    it('J1: keeps the PR walk-through when nothing waits', async () => {
        seed([session('coord', null)]);
        const screen = await renderPrompts();
        expect(screen.findByTestId('ip-walk-waiting')).toBeNull();
        await screen.pressByTestIdAsync('ip-walk-prs');
        expect(readComposerText('coord')).toBe(t('ignorePrevious.walkPrsPrompt'));
        expect(focused).toBe(true);
    });

    it('says so when no writable composer is mounted', async () => {
        seed([session('coord', null)]);
        unregister();
        const screen = await renderPrompts();
        await screen.pressByTestIdAsync('ip-walk-prs');
        expect(state.alert).toHaveBeenCalledWith('Composer unavailable', expect.stringContaining('Nothing was sent'));
        expect(focused).toBe(false);
    });
});
