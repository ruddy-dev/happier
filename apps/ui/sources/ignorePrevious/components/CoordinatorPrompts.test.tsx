import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
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
    alert: vi.fn(),
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

async function renderPrompts() {
    const { CoordinatorPrompts } = await import('./CoordinatorPrompts');
    return renderScreen(<CoordinatorPrompts coordinatorId="coord" />);
}

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
        state.alert.mockReset();
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

    it('R10/R24: the mixed prompt counts editable waits without approval rights and keeps view-only waits in the listing', async () => {
        const shared = { accessLevel: 'edit' as const, canApprovePermissions: false };
        seed([
            session('coord', { tool: 'Bash', arguments: { command: 'coordinator-command' }, createdAt: 1 }),
            session('owner', { tool: 'Bash', arguments: { command: 'owner-command' }, createdAt: 2 }),
            { ...session('editor', { tool: 'Bash', arguments: { command: 'editor-command' }, createdAt: 3 }), ...shared },
            { ...session('viewer', { tool: 'Bash', arguments: { command: 'viewer-command' }, createdAt: 4 }), accessLevel: 'view' },
        ]);
        act(() => storage.getState().mergeSessionListRenderables([
            buildSessionListRenderableFromSession({ ...session('editor-unloaded', null), ...shared, pendingPermissionRequestCount: 1 }),
            buildSessionListRenderableFromSession({ ...session('viewer-unloaded', null), accessLevel: 'view', pendingPermissionRequestCount: 1 }),
        ]));
        const { readDeskWaits } = await import('../model/useDeskWaits');
        const screen = await renderPrompts();
        await screen.pressByTestIdAsync('ip-walk-waiting');
        const text = String(readComposerText('coord'));
        expect(text).toContain('owner-command');
        expect(text).toContain('editor-command');
        expect(text).toContain('session editor-unloaded');
        expect(text).not.toContain('viewer');
        expect(text).not.toContain('coordinator-command');
        expect(screen.getTextContent()).toContain(t('ignorePrevious.walkWaiting', { count: 3 }));
        expect(readDeskWaits().items.map(item => item.sessionId)).toEqual(['coord', 'owner', 'editor', 'viewer']);
        expect(readDeskWaits().unloaded.map(item => item.sessionId).sort()).toEqual(['editor-unloaded', 'viewer-unloaded']);

        // The prompt reads fresh attention on press even if the chip remains mounted.
        act(() => storage.getState().applySessions([
            { ...storage.getState().sessions.editor!, accessLevel: 'view' },
        ]));
        expect(screen.getTextContent()).toContain(t('ignorePrevious.walkWaiting', { count: 2 }));
        unregister();
        let nextText = '';
        unregister = registerComposerRequestHandle('coord', { setText: value => { nextText = value; }, getText: () => nextText, focus: () => {} });
        await screen.pressByTestIdAsync('ip-walk-waiting');
        expect(nextText).not.toContain('editor-command');
        expect(nextText).toContain('session editor-unloaded');
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
