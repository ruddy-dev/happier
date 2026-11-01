import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { renderScreen } from '@/dev/testkit';
import { Text } from '@/components/ui/text/Text';
import type { NormalizedMessage } from '@/sync/typesRaw';
import { storage } from '@/sync/domains/state/storage';
import type { Session } from '@/sync/domains/state/storageTypes';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

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
    return createModalModuleMock().module;
});

// The panel imports @/sync/ops, which imports the sync singleton; the chip sends through it.
vi.mock('@/sync/sync', async () => {
    const { installSyncStub } = await import('@/dev/testkit/mocks/sync');
    return installSyncStub({ submitMessage: vi.fn(async () => undefined) } as never)();
});

/** A live session whose requests the app reads from its transcript (shouldReadTranscriptForPendingRequests). */
function session(id: string, overrides: Partial<Session> = {}): Session {
    return {
        id,
        seq: 1,
        encryptionMode: 'plain',
        createdAt: 1,
        updatedAt: 1,
        active: true,
        activeAt: 1,
        thinking: false,
        thinkingAt: 0,
        presence: 'online',
        accessLevel: 'edit',
        canApprovePermissions: true,
        metadataVersion: 1,
        agentStateVersion: 1,
        metadata: { path: `/w/${id}`, host: 'localhost', summary: { text: `Session ${id}`, updatedAt: 1 } },
        agentState: {},
        ...overrides,
    } as Session;
}

/** No `seq`: a message seq above the session's would replace the Session and hide the gap under test. */
function pendingToolCall(id: string, createdAt: number): NormalizedMessage {
    return {
        id: `msg-${id}`, localId: null, createdAt,
        role: 'agent', isSidechain: false,
        content: [{
            type: 'tool-call', id, name: 'bash',
            input: { permissionId: id, status: 'pending', command: `run ${id}` },
            description: null, uuid: `msg-${id}`, parentUUID: null,
        }],
    } as NormalizedMessage;
}

function resultFor(id: string, createdAt: number): NormalizedMessage {
    return {
        id: `result-${id}`, localId: null, createdAt,
        role: 'agent', isSidechain: false,
        content: [{
            type: 'tool-result', tool_use_id: id, content: 'done',
            is_error: false, permissions: { result: 'approved', date: createdAt },
            uuid: `result-${id}`, parentUUID: null,
        }],
    } as NormalizedMessage;
}

function text(id: string, createdAt: number): NormalizedMessage {
    return {
        id, localId: null, createdAt,
        role: 'agent', isSidechain: false,
        content: [{ type: 'text', text: 'Working', uuid: id, parentUUID: null }],
    } as NormalizedMessage;
}

function seed(sessions: Session[], transcripts: Record<string, NormalizedMessage[]> = {}) {
    act(() => {
        storage.getState().applySessions(sessions);
        for (const [id, messages] of Object.entries(transcripts)) storage.getState().applyMessages(id, messages);
        storage.getState().applyReady();
    });
}

/** Every entry the desk subscribes to today, by identity: `list` and `lookup` change exactly when one of these does. */
function snapshotDeskEntries() {
    const s = storage.getState();
    return { sessions: { ...s.sessions }, rows: { ...s.sessionListRenderables } };
}

function expectDeskEntriesUnchanged(before: ReturnType<typeof snapshotDeskEntries>) {
    const s = storage.getState();
    expect(Object.keys(s.sessions)).toEqual(Object.keys(before.sessions));
    for (const id of Object.keys(before.sessions)) expect(s.sessions[id], `session ${id}`).toBe(before.sessions[id]);
    expect(Object.keys(s.sessionListRenderables)).toEqual(Object.keys(before.rows));
    for (const id of Object.keys(before.rows)) expect(s.sessionListRenderables[id], `row ${id}`).toBe(before.rows[id]);
}

async function renderDesk() {
    const { WaitingPanel } = await import('./WaitingPanel');
    const { CoordinatorPrompts } = await import('./CoordinatorPrompts');
    const { useWaitingCount } = await import('../model/useDeskWaits');
    function CountProbe() {
        return <Text testID="probe-count">{String(useWaitingCount())}</Text>;
    }
    return renderScreen(
        <>
            <WaitingPanel />
            <CoordinatorPrompts coordinatorId="c1" />
            <CountProbe />
        </>,
    );
}

type Screen = Awaited<ReturnType<typeof renderDesk>>;

const occurrences = (screen: Screen, needle: string) => screen.getTextContent().split(needle).length - 1;
const textOf = (screen: Screen, testID: string) => {
    const node = screen.findByTestId(testID);
    return node ? String([node.props.children].flat().join('')) : null;
};
const chipText = (screen: Screen) => {
    const chip = screen.findByTestId('ip-walk-waiting');
    if (!chip) return null;
    return chip.findAll((node) => typeof node.props?.children === 'string').map((node) => node.props.children).join('');
};

describe('WaitingPanel follows the transcript', () => {
    let previous: ReturnType<typeof storage.getState>;
    beforeEach(() => {
        previous = storage.getState();
    });
    afterEach(() => {
        act(() => {
            storage.setState(previous, true);
        });
    });

    it('answering the older of two requests drops it from Waiting, the count and the chip', async () => {
        seed([session('s1')], { s1: [pendingToolCall('p1', 200), pendingToolCall('p2', 300)] });
        const screen = await renderDesk();
        expect(occurrences(screen, 'Open session')).toBe(2);
        expect(textOf(screen, 'probe-count')).toBe('2');
        expect(chipText(screen)).toContain('(2)');

        const before = snapshotDeskEntries();
        // The result lands between the two calls, so the newest pending request and its timestamps don't move.
        act(() => {
            storage.getState().applyMessages('s1', [resultFor('p1', 250)]);
        });
        expectDeskEntriesUnchanged(before);

        expect(occurrences(screen, 'Open session')).toBe(1);
        expect(textOf(screen, 'probe-count')).toBe('1');
        expect(chipText(screen)).toContain('(1)');
    });

    it('request details that arrive after the row turn the bare row into a card', async () => {
        seed([
            session('s1', {
                pendingPermissionRequestCount: 1,
                pendingUserActionRequestCount: 0,
                pendingRequestObservedAt: 200,
                // The server row already knows the request's activity; only the transcript catches up.
                // Without this the tool-call bumps the row's meaningfulActivityAt and masks the gap.
                meaningfulActivityAt: 200,
            } as Partial<Session>),
        ]);
        const screen = await renderDesk();
        expect(screen.getTextContent()).toContain('Waiting on you. Open the session to see what.');
        expect(textOf(screen, 'probe-count')).toBe('1');

        const before = snapshotDeskEntries();
        act(() => {
            storage.getState().applyMessages('s1', [pendingToolCall('p1', 200)]);
        });
        expectDeskEntriesUnchanged(before);

        expect(screen.getTextContent()).toContain('Allow bash');
        expect(screen.getTextContent()).not.toContain('Waiting on you. Open the session to see what.');
        expect(textOf(screen, 'probe-count')).toBe('1');
    });

    it('must keep a bare waiting row counted when another session\'s transcript changes', async () => {
        seed([
            session('s1', {
                pendingPermissionRequestCount: 1,
                pendingUserActionRequestCount: 0,
                pendingRequestObservedAt: 100,
            } as Partial<Session>),
            session('s2'),
        ]);
        const screen = await renderDesk();
        act(() => {
            storage.getState().applyMessages('s2', [text('s2-text', 250)]);
        });
        expect(screen.getTextContent()).toContain('Waiting on you. Open the session to see what.');
        expect(textOf(screen, 'probe-count')).toBe('1');
    });

    it('must keep the request card when a plain text message arrives on the same session', async () => {
        seed([session('s1')], { s1: [pendingToolCall('p1', 200)] });
        const screen = await renderDesk();
        expect(occurrences(screen, 'Open session')).toBe(1);
        act(() => {
            storage.getState().applyMessages('s1', [text('s1-text', 250)]);
        });
        expect(occurrences(screen, 'Open session')).toBe(1);
        expect(textOf(screen, 'probe-count')).toBe('1');
    });

    it('must not show a transcript request the server says is no longer pending', async () => {
        // Live session, but its row projects zero pending requests: the transcript's old tool-call is stale.
        seed(
            [session('s1', { pendingPermissionRequestCount: 0, pendingUserActionRequestCount: 0, pendingRequestObservedAt: 300 } as Partial<Session>)],
            { s1: [pendingToolCall('p1', 200)] },
        );
        const screen = await renderDesk();
        expect(occurrences(screen, 'Open session')).toBe(0);
        expect(textOf(screen, 'probe-count')).toBe('0');
    });

    it('must not show a stale transcript request for an inactive session', async () => {
        seed([session('s1', { active: false, presence: 1 })], { s1: [pendingToolCall('p1', 200)] });
        const screen = await renderDesk();
        expect(occurrences(screen, 'Open session')).toBe(0);
        expect(textOf(screen, 'probe-count')).toBe('0');
    });
});
