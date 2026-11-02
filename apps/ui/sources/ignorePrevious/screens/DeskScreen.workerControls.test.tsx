import { RpcError } from '@happier-dev/protocol/rpcErrors';
import { RPC_ERROR_CODES } from '@happier-dev/protocol/rpc';
import { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { findTestInstanceByTypeContainingText, pressTestInstanceAsync } from '@/dev/testkit/render/renderScreen';
import { createMachineFixture } from '@/dev/testkit/fixtures/machineFixtures';
import { storage } from '@/sync/domains/state/storage';

import { loadDeskScript, startDeskScenario, type DeskScenario } from '../testkit/deskScenario';
import type { Session } from '@/sync/domains/state/storageTypes';
import type { NormalizedMessage } from '@/sync/typesRaw';

// React's test-only act flag is not declared on the platform global type.
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;


const boundary = vi.hoisted(() => ({ rpc: vi.fn(), alert: vi.fn(), publish: vi.fn() }));

vi.mock('@/sync/runtime/orchestration/serverScopedRpc/serverScopedSessionRpc', async (importOriginal) => {
    const { installServerScopedSessionRpcModuleMock } = await import('@/dev/testkit/mocks/serverScopedRpc');
    return installServerScopedSessionRpcModuleMock({ sessionRpcWithServerScope: boundary.rpc })(importOriginal);
});

vi.mock('@expo/vector-icons', async () => {
    const { createExpoVectorIconsMock } = await import('@/dev/testkit/mocks/icons');
    return createExpoVectorIconsMock();
});

// The desk clock pauses while another screen covers the desk; here the desk is always focused.
vi.mock('@react-navigation/native', async () => {
    const { createReactNavigationNativeMock } = await import('@/dev/testkit/mocks/reactNavigation');
    return createReactNavigationNativeMock();
});

vi.mock('expo-router', async () => {
    const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
    return createExpoRouterMock().module;
});

vi.mock('@/modal', async () => {
    const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
    return createModalModuleMock({ spies: { alert: boundary.alert } }).module;
});

vi.mock('@/sync/sync', async () => {
    const { installSyncStub } = await import('@/dev/testkit/mocks/sync');
    return installSyncStub({ publishSessionPermissionModeToMetadata: boundary.publish })();
});

vi.mock('@/hooks/ui/useReducedMotionPreference', async () => {
    const { installReducedMotionMock } = await import('@/dev/testkit/mocks/reducedMotion');
    return installReducedMotionMock(false)();
});

vi.mock('@/components/sessions/shell/SessionView', async () => {
    const { deskScreenMocks } = await import('../testkit/deskScreenMocks');
    return deskScreenMocks.sessionView();
});

vi.mock('@/hooks/session/useHydrateSessionForRoute', async () => {
    const { deskScreenMocks } = await import('../testkit/deskScreenMocks');
    return deskScreenMocks.hydrateSessionForRoute();
});


const script = loadDeskScript({ covers: ['C2', 'C5', 'C7', 'W8', 'W9', 'W10'], sessions: [
    { id: 'w1', title: 'Worker', path: '/work/atr-6-build', initial: {
        active: true, thinking: true, metadata: { flavor: 'claude', permissionMode: 'default', permissionModeUpdatedAt: 1 },
    } },
] });

async function openDetails(scenario: DeskScenario) {
    await pressTestInstanceAsync(scenario.screen.find((node) => node.props?.accessibilityRole === 'button'
        && typeof node.props.onPress === 'function'
        && node.findAll((child) => child.children.includes('Details')).length > 0));
}

function updateSession(patch: Partial<Session>) {
    act(() => {
        const current = storage.getState().sessions.w1!;
        storage.getState().applySessions([{ ...current, ...patch, seq: current.seq + 1,
            metadataVersion: current.metadataVersion + 1, agentStateVersion: current.agentStateVersion + 1 }]);
    });
}

describe('Desk worker controls catalogue replay', () => {
    let scenario: DeskScenario | null = null;
    beforeEach(() => {
        boundary.rpc.mockReset().mockResolvedValue(undefined);
        boundary.alert.mockReset();
        boundary.publish.mockReset().mockResolvedValue(undefined);
    });
    afterEach(async () => { await scenario?.dispose(); scenario = null; });
    async function start() {
        scenario = await startDeskScenario({ script });
        await openDetails(scenario);
        return scenario;
    }
    async function choose(mode = 'safe-yolo') {
        await scenario!.screen.pressByTestIdAsync('ip-mode-w1');
        await scenario!.screen.pressByTestIdAsync(`ip-mode-option-w1-${mode}`);
    }

    it.each([
        ['METHOD_NOT_AVAILABLE', "worker is not listening"],
        ['scoped_session_encryption_unavailable', 'encryption is unavailable'],
        ['session_encryption_not_found', 'encryption is unavailable'],
    ])('C2: %s leaves thinking and the bulb alone and explains the failed Stop', async (message, reason) => {
        const s = await start();
        const error = new RpcError(message, message === 'METHOD_NOT_AVAILABLE' ? RPC_ERROR_CODES.METHOD_NOT_AVAILABLE : message);
        boundary.rpc.mockRejectedValue(error);
        const before = storage.getState().sessions.w1;
        await s.screen.pressByTestIdAsync('ip-stop-w1');
        expect(storage.getState().sessions.w1).toBe(before);
        expect(s.textOf('ip-count-working')).toBe('1');
        expect(s.textOf('ip-stop-error-w1')).toContain(reason);
    });

    it('C1: a successful Stop clears thinking through the real operation', async () => {
        const s = await start();
        await s.screen.pressByTestIdAsync('ip-stop-w1');
        expect(storage.getState().sessions.w1.thinking).toBe(false);
        expect(s.textOf('ip-count-working')).toBe('0');
    });

    it('C2: a rejected Stop explains the failure without clearing the working bulb', async () => {
        const s = await start();
        boundary.rpc.mockResolvedValue({ error: 'Abort denied', errorCode: RPC_ERROR_CODES.FORBIDDEN });
        const before = storage.getState().sessions.w1;
        await s.screen.pressByTestIdAsync('ip-stop-w1');
        expect(storage.getState().sessions.w1).toBe(before);
        expect(s.textOf('ip-count-working')).toBe('1');
        expect(s.textOf('ip-stop-error-w1')).toContain('rejected');
    });

    it('C5: next-prompt selection stays pending until metadata catches up', async () => {
        const s = await start();
        act(() => storage.getState().applySettings({ ...storage.getState().settings, sessionPermissionModeApplyTiming: 'next_prompt' }, (storage.getState().settingsVersion ?? 0) + 1));
        await choose();
        expect(storage.getState().sessions.w1.permissionMode).toBe('safe-yolo');
        expect(boundary.publish).not.toHaveBeenCalled();
        expect(s.textOf('ip-mode-current-w1')).toBe('Published mode: default');
        expect(s.textOf('ip-mode-pending-w1')).toContain('next prompt');
        const latest = storage.getState().sessions.w1;
        await s.apply('w1', { metadata: { permissionMode: 'acceptEdits', permissionModeUpdatedAt: latest.permissionModeUpdatedAt } });
        expect(s.textOf('ip-mode-current-w1')).toBe('Published mode: safe-yolo');
        expect(s.textOf('ip-mode-pending-w1')).toBeNull();
    });

    it('C5: missing published mode is unknown, never inferred from local selection', async () => {
        const s = await start();
        const current = storage.getState().sessions.w1;
        updateSession({ metadata: { ...current.metadata!, permissionMode: undefined, permissionModeUpdatedAt: undefined }, permissionMode: 'yolo', permissionModeUpdatedAt: undefined });
        expect(s.textOf('ip-mode-current-w1')).toBe('Mode unknown');
    });

    it('C5: failed metadata publication remains pending with an explicit failure', async () => {
        const s = await start();
        expect(storage.getState().settings.sessionPermissionModeApplyTiming).toBe('immediate');
        boundary.publish.mockRejectedValue(new Error('offline'));
        await choose();
        expect(s.textOf('ip-mode-current-w1')).toBe('Published mode: default');
        expect(s.textOf('ip-mode-pending-w1')).toContain('not sent');
    });

    it.each([['claude', 'safe-yolo', 'acceptEdits'], ['claude', 'yolo', 'bypassPermissions'], ['codex', 'safe-yolo', 'acceptEdits']])('W10: reports observed mode approvals only for Claude (%s %s)', async (flavor, mode, reportedMode) => {
        const s = await start();
        await s.apply('w1', { metadata: { flavor }, requests: {
            edit: { tool: 'Edit', arguments: { file_path: '/work/a.ts' } },
            shell: { tool: 'Bash', arguments: { command: 'echo test' } },
            question: { tool: 'AskUserQuestion', kind: 'user_action', arguments: {} },
            old: { tool: 'Edit', arguments: { file_path: '/work/old.ts' } },
        } });
        const beforeChange = storage.getState().sessions.w1;
        updateSession({ agentState: { ...beforeChange.agentState, completedRequests: {
            old: { ...beforeChange.agentState!.requests!.old, status: 'approved', mode: reportedMode, completedAt: Date.now() },
        } } });
        await s.openApprovals();
        await choose(mode);
        expect(s.textOf('ip-mode-cleared-w1')).toBeNull();
        const current = storage.getState().sessions.w1;
        const requests = current.agentState!.requests!;
        updateSession({ agentState: { ...current.agentState, requests: { shell: requests.shell, question: requests.question },
            completedRequests: {
                edit: { ...requests.edit, status: 'approved', mode: reportedMode, completedAt: Date.now() },
                shell: { ...requests.shell, status: 'approved', mode: reportedMode, completedAt: Date.now() },
                question: { ...requests.question, status: 'approved', mode: reportedMode, completedAt: Date.now() },
            } } });
        if (flavor === 'claude') {
            expect(s.textOf('ip-mode-cleared-w1')).toContain('/work/a.ts');
            if (mode === 'yolo') expect(s.textOf('ip-mode-cleared-w1')).toContain('echo test');
            else expect(s.textOf('ip-mode-cleared-w1')).not.toContain('echo test');
            expect(s.textOf('ip-mode-cleared-w1')).not.toContain('AskUserQuestion');
        } else expect(s.textOf('ip-mode-cleared-w1')).toBeNull();
    });

    it.each(['view', 'edit'] as const)('W9: shared %s without approval grant has no unusable answers', async (accessLevel) => {
        const s = await start();
        updateSession({ accessLevel, canApprovePermissions: false });
        await s.apply('w1', { requests: { r1: { tool: 'Bash', arguments: { command: 'echo test' } } } });
        await s.openApprovals();
        expect(s.screen.findByTestId('ip-waiting-allow-r1')).toBeNull();
        expect(s.screen.findByTestId('ip-waiting-deny-r1')).toBeNull();
        expect(s.screen.getTextContent()).toMatch(/view.only|not.*granted|not.*allow/i);
        if (accessLevel === 'view') {
            expect(s.screen.findByTestId('ip-stop-w1')).toBeNull();
            expect(s.screen.findByTestId('ip-mode-w1')).toBeNull();
        }
    });

    it.each(['revoked', 'replaced', 'stale', 'unknown'])('C7: %s machine has honest Resume availability', async (kind) => {
        const s = await start();
        await s.apply('w1', { active: false, thinking: false });
        if (kind !== 'unknown') act(() => storage.getState().applyMachines([createMachineFixture({
            id: 'desk-test-machine', active: true, activeAt: kind === 'stale' ? 1 : Date.now(),
            ...(kind === 'revoked' ? { revokedAt: Date.now() } : {}),
            ...(kind === 'replaced' ? { replacedByMachineId: 'replacement', replacedAt: Date.now() } : {}),
        })]));
        if (kind === 'unknown') expect(s.screen.findByTestId('ip-resume-w1')).not.toBeNull();
        else {
            expect(s.textOf('ip-offline-w1')).toBe('Machine offline');
            expect(s.screen.findByTestId('ip-resume-w1')).toBeNull();
        }
    });

    it('C7/W9: an offline machine does not prevent a shared viewer opening the transcript', async () => {
        const s = await start();
        await s.apply('w1', { active: false, thinking: false });
        updateSession({ accessLevel: 'view' });
        act(() => storage.getState().applyMachines([createMachineFixture({ id: 'desk-test-machine', active: true, activeAt: 1 })]));
        expect(storage.getState().machines['desk-test-machine'].activeAt).toBe(1);
        expect(s.textOf('ip-offline-w1')).toBe('Machine offline');
        expect(s.screen.findByTestId('ip-open-w1')).not.toBeNull();
        expect(s.screen.findByTestId('ip-resume-w1')).toBeNull();
    });

    it('W8: a transcript-only request appears without a session-record change', async () => {
        const s = await start();
        await s.apply('w1', { thinking: false, metadata: { flavor: 'codex' },
            pendingPermissionRequestCount: 1, pendingRequestObservedAt: 0 });
        updateSession({ meaningfulActivityAt: Date.now() });
        await s.openApprovals();
        const before = storage.getState().sessions.w1;
        const message: NormalizedMessage = {
            id: 'tool-message', localId: null, createdAt: Date.now(), role: 'agent', isSidechain: false,
            content: [{ type: 'tool-call', id: 'transcript-request', name: 'bash',
                input: { permissionId: 'transcript-request', status: 'pending', command: 'echo transcript' },
                description: null, uuid: 'tool-message', parentUUID: null }],
        };
        act(() => { storage.getState().applyMessages('w1', [message]); });
        expect(storage.getState().sessions.w1).toBe(before);
        expect(s.screen.findByTestId('ip-waiting-allow-transcript-request')).not.toBeNull();
    });
});
