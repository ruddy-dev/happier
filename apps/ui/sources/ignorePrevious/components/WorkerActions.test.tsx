import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pressTestInstanceAsync, renderScreen } from '@/dev/testkit';
import { createMachineFixture } from '@/dev/testkit/fixtures/machineFixtures';
import { createSessionFixture } from '@/dev/testkit/fixtures/sessionFixtures';
import { storage } from '@/sync/domains/state/storage';
import type { Session } from '@/sync/domains/state/storageTypes';

import type { WorkerRow } from '../model/groupWorkers';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const state = vi.hoisted(() => ({
    rpc: vi.fn(),
    publish: vi.fn(async (_params: unknown) => undefined),
    navigate: vi.fn(),
    alert: vi.fn(),
}));

vi.mock('@expo/vector-icons', async () => {
    const { createExpoVectorIconsMock } = await import('@/dev/testkit/mocks/icons');
    return createExpoVectorIconsMock();
});

vi.mock('expo-router', async () => {
    const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
    return createExpoRouterMock({ router: { navigate: state.navigate, push: state.navigate } }).module;
});

// Keep the abort operation real; replace only its RPC transport boundary.
vi.mock('@/sync/runtime/orchestration/serverScopedRpc/serverScopedSessionRpc', async (importOriginal) => {
    const { installServerScopedSessionRpcModuleMock } = await import('@/dev/testkit/mocks/serverScopedRpc');
    return installServerScopedSessionRpcModuleMock({ sessionRpcWithServerScope: state.rpc })(importOriginal);
});
vi.mock('@react-navigation/native', async () => {
    const { createReactNavigationNativeMock } = await import('@/dev/testkit/mocks/reactNavigation');
    return createReactNavigationNativeMock();
});

// Publishing the mode to the session's metadata is the network write; the store stays real.
vi.mock('@/sync/sync', async () => {
    const { installSyncStub } = await import('@/dev/testkit/mocks/sync');
    return installSyncStub({ publishSessionPermissionModeToMetadata: state.publish as never })();
});

vi.mock('@/modal', async () => {
    const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
    return createModalModuleMock({ spies: { alert: state.alert } }).module;
});

function seedSession(id: string, extra: Partial<Session> = {}) {
    storage.getState().applySessions([
        createSessionFixture({
            id,
            active: true,
            metadata: { path: '/work/project', host: 'box', homeDir: '/work', machineId: 'machine-1', flavor: 'claude' } as Session['metadata'],
            ...extra,
        }),
    ]);
}

function worker(sessionId: string, extra: Partial<WorkerRow> = {}): WorkerRow {
    return { sessionId, title: `Title ${sessionId}`, issueKey: 'ATR-13', bulb: 'idle', permissionMode: 'default', updatedAt: 1, ...extra };
}

async function renderActions(row: WorkerRow) {
    const { WorkerActions } = await import('./WorkerActions');
    return renderScreen(<WorkerActions worker={row} />);
}

describe('WorkerActions', () => {
    beforeEach(() => {
        storage.setState({ machines: {} });
        storage.getState().setSocketStatus('connected');
        state.rpc.mockReset().mockResolvedValue(undefined);
        state.publish.mockReset().mockResolvedValue(undefined);
        state.navigate.mockReset();
        state.alert.mockReset();
    });

    it('stops the turn of a worker that is busy, and offers no stop to an idle one', async () => {
        seedSession('busy');
        const busy = await renderActions(worker('busy', { canStop: true }));
        await pressTestInstanceAsync(busy.findByTestId('ip-stop-busy')!);
        expect(state.rpc).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'busy', method: 'abort' }));

        seedSession('idle');
        const idle = await renderActions(worker('idle', { canStop: false }));
        expect(idle.findByTestId('ip-stop-idle')).toBeNull();
    });

    it('offers no stop on a busy session you can only view', async () => {
        seedSession('watched', { accessLevel: 'view' } as Partial<Session>);
        const screen = await renderActions(worker('watched', { canStop: true }));
        expect(screen.findByTestId('ip-stop-watched')).toBeNull();
    });

    it('marks the option the stored mode means, as the composer does', async () => {
        seedSession('planner', { permissionMode: 'plan' } as Partial<Session>);
        const screen = await renderActions(worker('planner', { permissionMode: 'plan' }));
        await pressTestInstanceAsync(screen.findByTestId('ip-mode-planner')!);
        expect(screen.findByTestId('ip-mode-option-planner-read-only')!.props.accessibilityState).toEqual({ selected: true });
        expect(screen.findByTestId('ip-mode-option-planner-default')!.props.accessibilityState).toEqual({ selected: false });
    });

    it('changes the permission mode through the shared apply path', async () => {
        seedSession('w1', { permissionMode: 'default' } as Partial<Session>);
        const screen = await renderActions(worker('w1'));
        await pressTestInstanceAsync(screen.findByTestId('ip-mode-w1')!);
        await pressTestInstanceAsync(screen.findByTestId('ip-mode-option-w1-read-only')!);

        expect(storage.getState().sessions.w1?.permissionMode).toBe('read-only');
        await vi.waitFor(() => expect(state.publish).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'w1', permissionMode: 'read-only' })));
    });

    it('shows the mode but offers no change on a view-only session', async () => {
        seedSession('shared', { accessLevel: 'view', permissionMode: 'default' } as Partial<Session>);
        const screen = await renderActions(worker('shared'));
        expect(screen.getTextContent()).toContain('Mode unknown');
        expect(screen.findByTestId('ip-mode-shared')).toBeNull();
    });

    it('says the machine is offline instead of offering to resume', async () => {
        // Offline as the shared reachability owner sees it: listed, but its last heartbeat is long past.
        storage.getState().applyMachines([createMachineFixture({ id: 'machine-1', active: true, activeAt: 1 })]);
        seedSession('gone', { active: false });
        const screen = await renderActions(worker('gone', { inactive: true }));
        expect(screen.findByTestId('ip-offline-gone')).not.toBeNull();
        expect(screen.findByTestId('ip-resume-gone')).toBeNull();
    });

    it('opens an inactive worker on a reachable machine so its session can resume it', async () => {
        storage.getState().applyMachines([createMachineFixture({ id: 'machine-1', active: true, activeAt: Date.now() })]);
        seedSession('nap', { active: false });
        const screen = await renderActions(worker('nap', { inactive: true }));
        expect(screen.findByTestId('ip-offline-nap')).toBeNull();
        await pressTestInstanceAsync(screen.findByTestId('ip-resume-nap')!);
        expect(JSON.stringify(state.navigate.mock.calls)).toContain('nap');
    });

    it('C7/W9: keeps plain Open available to a viewer even when the machine is offline', async () => {
        storage.getState().applyMachines([createMachineFixture({ id: 'machine-1', active: true, activeAt: 1 })]);
        seedSession('peek', { active: false, accessLevel: 'view' } as Partial<Session>);
        const screen = await renderActions(worker('peek', { inactive: true }));
        expect(screen.findByTestId('ip-resume-peek')).toBeNull();
        await pressTestInstanceAsync(screen.findByTestId('ip-open-peek')!);
        expect(JSON.stringify(state.navigate.mock.calls)).toContain('peek');
    });

    it('promises no resume before the session record has loaded', async () => {
        const screen = await renderActions(worker('ghost', { inactive: true }));
        expect(screen.findByTestId('ip-resume-ghost')).toBeNull();
        expect(screen.findByTestId('ip-open-ghost')).not.toBeNull();
    });
});
