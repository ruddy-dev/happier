import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { findTestInstanceByTypeContainingText, pressTestInstanceAsync, renderScreen } from '@/dev/testkit';
import { createSessionFixture } from '@/dev/testkit/fixtures/sessionFixtures';
import { storage } from '@/sync/domains/state/storage';
import type { Session } from '@/sync/domains/state/storageTypes';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let previous: ReturnType<typeof storage.getState>;

/**
 * Loads sessions into the real store the way the first sync does: list rows and full records.
 * Each seed starts from the saved store, so a test's own seed replaces the shared one.
 */
function seed(sessions: Session[]) {
    act(() => {
        storage.setState(previous, true);
        storage.getState().setSocketStatus('connected');
        storage.getState().applySessions(sessions);
        // The first sync has finished; before it the panel says Connecting… (F4).
        storage.getState().applyReady();
    });
}

const state = vi.hoisted(() => ({
    allow: vi.fn(async (..._args: unknown[]) => {}),
    deny: vi.fn(async (..._args: unknown[]) => {}),
    alert: vi.fn(),
    navigate: vi.fn(),
}));

vi.mock('@react-navigation/native', async () => {
    const { createReactNavigationNativeMock } = await import('@/dev/testkit/mocks/reactNavigation');
    return createReactNavigationNativeMock();
});

vi.mock('@expo/vector-icons', async () => {
    const { createExpoVectorIconsMock } = await import('@/dev/testkit/mocks/icons');
    return createExpoVectorIconsMock();
});

vi.mock('@/sync/ops', () => ({
    sessionAllow: state.allow,
    sessionDeny: state.deny,
}));

vi.mock('@/modal', async () => {
    const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
    return createModalModuleMock({ spies: { alert: state.alert } }).module;
});

vi.mock('expo-router', async () => {
    const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
    return createExpoRouterMock({ router: { navigate: state.navigate } }).module;
});

function sessionWithRequest(id: string, request: Record<string, unknown> | null, extra: Partial<Session> = {}): Session {
    return createSessionFixture({
        id,
        active: true,
        agentState: request ? ({ requests: { r1: request } } as unknown as Session['agentState']) : null,
        ...extra,
    });
}

async function renderPanel() {
    const { WaitingPanel } = await import('./WaitingPanel');
    return renderScreen(<WaitingPanel />);
}

function button(screen: Awaited<ReturnType<typeof renderPanel>>, label: string) {
    const found = findTestInstanceByTypeContainingText(screen.tree, 'Pressable', label);
    expect(found, `button "${label}"`).toBeTruthy();
    return found!;
}

describe('WaitingPanel', () => {
    afterEach(() => {
        act(() => {
            storage.setState(previous, true);
        });
    });

    beforeEach(() => {
        previous = storage.getState();
        state.allow.mockReset().mockResolvedValue(undefined);
        state.deny.mockReset().mockResolvedValue(undefined);
        state.alert.mockReset();
        state.navigate.mockReset();
        seed([
            sessionWithRequest('s1', { tool: 'Bash', arguments: { command: 'rm -rf build' }, createdAt: 10 }),
            sessionWithRequest('s2', null),
        ]);
    });

    it('shows a pending request and allows it', async () => {
        const screen = await renderPanel();
        expect(screen.getTextContent()).toContain('rm -rf build');
        await pressTestInstanceAsync(button(screen, 'Allow Bash'));
        expect(state.allow).toHaveBeenCalledWith('s1', 'r1');
    });

    it('denies a request', async () => {
        const screen = await renderPanel();
        await pressTestInstanceAsync(button(screen, 'Deny'));
        expect(state.deny).toHaveBeenCalledWith('s1', 'r1', undefined, undefined, 'denied');
    });

    it('opens the session', async () => {
        const screen = await renderPanel();
        await pressTestInstanceAsync(button(screen, 'Open session'));
        expect(String(state.navigate.mock.calls[0]?.[0])).toMatch(/^\/session\/s1(\?|$)/);
    });

    it('closes the approvals card when it opens a session from it', async () => {
        const { ApprovalsCard } = await import('./Approvals');
        const onClose = vi.fn();
        const screen = await renderScreen(<ApprovalsCard onClose={onClose} />);
        await pressTestInstanceAsync(button(screen as Awaited<ReturnType<typeof renderPanel>>, 'Open session'));
        expect(String(state.navigate.mock.calls[0]?.[0])).toMatch(/^\/session\/s1(\?|$)/);
        expect(onClose).toHaveBeenCalled();
    });

    it('says so when nothing needs you', async () => {
        seed([sessionWithRequest('s2', null)]);
        const screen = await renderPanel();
        expect(screen.findByTestId('ip-waiting')).toBeNull();
        expect(screen.findByTestId('ip-waiting-empty')).toBeTruthy();
    });

    it('leaves out archived sessions', async () => {
        seed([
            sessionWithRequest('s1', { tool: 'Bash', arguments: { command: 'ls' }, createdAt: 1 }, { archivedAt: 5 } as Partial<Session>),
        ]);
        const screen = await renderPanel();
        expect(screen.findByTestId('ip-waiting')).toBeNull();
    });

    it('says the answer was not sent when sending it fails', async () => {
        state.allow.mockRejectedValue(new Error('gone'));
        const screen = await renderPanel();
        await act(async () => {
            await pressTestInstanceAsync(button(screen, 'Allow Bash'));
        });
        expect(state.alert).toHaveBeenCalledWith(
            'Answer not sent',
            "Your answer didn't go through. Check the connection and try again.",
        );
    });

    it('offers only Open session for a question', async () => {
        seed([
            sessionWithRequest('s1', { tool: 'AskUserQuestion', kind: 'user_action', arguments: { questions: [] }, createdAt: 1 }),
        ]);
        const screen = await renderPanel();
        expect(screen.getTextContent()).not.toContain('Allow');
        expect(screen.getTextContent()).not.toContain('Deny');
        await pressTestInstanceAsync(button(screen, 'Open session'));
        expect(String(state.navigate.mock.calls[0]?.[0])).toMatch(/^\/session\/s1(\?|$)/);
    });

    it('lists a session that reports waiting requests it has not loaded', async () => {
        seed([
            sessionWithRequest('s3', null, { pendingPermissionRequestCount: 1 } as Partial<Session>),
        ]);
        const screen = await renderPanel();
        expect(screen.findByTestId('ip-waiting')).toBeTruthy();
        expect(screen.getTextContent()).not.toContain('Allow');
        await pressTestInstanceAsync(button(screen, 'Open session'));
        expect(String(state.navigate.mock.calls[0]?.[0])).toMatch(/^\/session\/s3(\?|$)/);
    });
});
