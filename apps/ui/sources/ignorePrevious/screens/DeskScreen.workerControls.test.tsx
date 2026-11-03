import { RpcError } from '@happier-dev/protocol/rpcErrors';
import { RPC_ERROR_CODES } from '@happier-dev/protocol/rpc';
import { SESSION_MESSAGE_USER_ATTENTION_IMPACT } from '@happier-dev/protocol';
import { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { findTestInstanceByTypeContainingText, pressTestInstanceAsync } from '@/dev/testkit/render/renderScreen';
import { createMachineFixture } from '@/dev/testkit/fixtures/machineFixtures';
import { storage } from '@/sync/domains/state/storage';
import { sync } from '@/sync/sync';
import { handleUpdateContainer } from '@/sync/engine/socket/socket';
import { SessionEncryption } from '@/sync/encryption/sessionEncryption';
import { SecretBoxEncryption } from '@/sync/encryption/encryptor';
import { EncryptionCache } from '@/sync/encryption/encryptionCache';
import { createDeferred } from '@/dev/testkit/hooks/createDeferred';
import { settleReceivedSessionMessages } from '@/sync/engine/sessions/sessionMessageMaterializationBarrier';
import { clearMountedSessionRealtimeRecordConsumers, registerSessionRealtimeRecordConsumer } from '@/sync/runtime/sessionRealtimeRecordConsumers';

import { loadDeskScript, startDeskScenario, type DeskScenario } from '../testkit/deskScenario';
import type { Session } from '@/sync/domains/state/storageTypes';
import { RawRecordSchema, type AgentEvent, type NormalizedMessage } from '@/sync/typesRaw';

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

// Same real socket/record routing as ATR-44. Closed workers must never invoke these loaders.
const noTranscript = vi.fn(() => { throw new Error('Closed worker started transcript work'); });
type RuntimeOutcome = Extract<AgentEvent, { type: 'runtime-config-outcome' }>;
type OutcomeOptions = Pick<Partial<RuntimeOutcome>, 'status' | 'reason' | 'changes'> & {
    timing?: RuntimeOutcome['timing'] | null; sourceServerId?: string; type?: 'new-message' | 'message-updated';
};
const socketLog = vi.fn();
const knownRemoteSeq = vi.fn();
async function prepareRuntimeOutcome(seq: number, effective: string, options: OutcomeOptions = {}) {
    const record = { role: 'agent', content: { id: `outcome-${seq}`, type: 'event', data: {
        type: 'runtime-config-outcome', provider: 'claude', runtime: 'claude-unified-terminal',
        status: options.status ?? 'applied', ...(options.timing === null ? {} : { timing: options.timing ?? 'current_window' }), message: 'Permission mode outcome',
        changes: options.changes ?? [{ key: 'permissionMode', requested: 'default', effective, ...(options.reason ? { reason: options.reason } : {}) }],
    } } };
    expect(RawRecordSchema.safeParse(record).success).toBe(true);
    const encryption = sync.encryption.getSessionEncryption('w1');
    const content = encryption ? { t: 'encrypted' as const, c: await encryption.encryptRawRecord(RawRecordSchema.parse(record)) }
        : { t: 'plain' as const, v: record };
    return () => handleUpdateContainer({
            encryption: sync.encryption, artifactDataKeys: new Map(),
            sourceServerId: options.sourceServerId,
            applySessions: rows => storage.getState().applySessions(rows),
            fetchSessions: noTranscript, applyMessages: noTranscript, onSessionVisible: noTranscript,
            isSessionMessagesLoaded: () => false, getSessionMaterializedMaxSeq: () => 0,
            markSessionMaterializedMaxSeq: noTranscript, onMessageGapDetected: noTranscript,
            assumeUsers: async () => {}, applyTodoSocketUpdates: async () => {},
            invalidateMachines: () => {}, invalidateSessions: noTranscript, invalidateArtifacts: () => {},
            invalidateFriends: () => {}, invalidateFriendRequests: () => {}, invalidateFeed: () => {},
            invalidateAutomations: () => {}, invalidateTodos: () => {}, onTaskLifecycleEvent: () => {},
            hydrateSessionById: noTranscript, log: { log: socketLog }, markSessionKnownRemoteSeq: knownRemoteSeq,
            updateData: { id: `outcome-${seq}`, seq, createdAt: Date.now(), body: {
                t: options.type ?? 'new-message', sid: 'w1', message: { id: `outcome-${seq}`, seq, localId: null,
                    createdAt: Date.now(), updatedAt: Date.now(), messageRole: 'event', content,
                    // The server supplies conservative attention facts for encrypted events.
                    attentionImpact: SESSION_MESSAGE_USER_ATTENTION_IMPACT,
                },
            } },
        });
}

async function runtimeOutcome(seq: number, effective: string, options: OutcomeOptions = {}) {
    const deliver = await prepareRuntimeOutcome(seq, effective, options);
    await act(async () => { await deliver(); });
}

describe('Desk worker controls catalogue replay', () => {
    let scenario: DeskScenario | null = null;
    beforeEach(() => {
        boundary.rpc.mockReset().mockResolvedValue(undefined);
        boundary.alert.mockReset();
        boundary.publish.mockReset().mockResolvedValue(undefined);
        noTranscript.mockClear();
        socketLog.mockClear();
        knownRemoteSeq.mockClear();
        vi.mocked(sync.encryption.getSessionEncryption).mockReset().mockReturnValue(null);
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

    it.each([{ flavor: 'claude', encrypted: false }, { flavor: 'claude', encrypted: true }, { flavor: 'codex', encrypted: false }])('C: $flavor mode confirmation (encrypted=$encrypted) never loads a closed worker', async ({ flavor, encrypted }) => {
        const s = await start();
        await s.apply('w1', { metadata: { flavor } });
        updateSession({ encryptionMode: encrypted ? 'e2ee' : 'plain' });
        if (encrypted) vi.mocked(sync.encryption.getSessionEncryption).mockReturnValue(new SessionEncryption('w1', new SecretBoxEncryption(new Uint8Array(32).fill(1)), new EncryptionCache()));
        expect(s.textOf('ip-mode-current-w1')).toBe('Published mode: default');
        await runtimeOutcome(20, 'acceptEdits', { timing: 'scheduled_for_next_prompt' });
        await runtimeOutcome(21, 'acceptEdits', { reason: 'delivered_unverified' });
        await runtimeOutcome(22, 'acceptEdits', { status: 'failed' });
        await runtimeOutcome(23, 'default', { sourceServerId: 'another-test-server' });
        expect(s.textOf('ip-mode-current-w1')).toBe('Published mode: default');
        await runtimeOutcome(23, 'default');
        expect(s.textOf('ip-mode-current-w1')).toBe(flavor === 'claude' ? 'Confirmed mode: default' : 'Published mode: default');
        await runtimeOutcome(24, 'acceptEdits');
        expect(s.textOf('ip-mode-current-w1')).toBe(flavor === 'claude' ? 'Confirmed mode: safe-yolo' : 'Published mode: default');
        expect(s.textOf('ip-mode-difference-w1')).toBe(flavor === 'claude' ? 'Differs from published mode: default' : null);
        // A late older envelope cannot replace the latest confirmation.
        await runtimeOutcome(23, 'default');
        expect(s.textOf('ip-mode-current-w1')).toBe(flavor === 'claude' ? 'Confirmed mode: safe-yolo' : 'Published mode: default');
        expect(noTranscript).not.toHaveBeenCalled();
        expect(storage.getState().sessionMessages.w1?.isLoaded).not.toBe(true);
        // Leaving and returning starts with published intent rather than a persisted acknowledgement.
        await s.dispose();
        scenario = null;
        const returned = await start();
        expect(returned.textOf('ip-mode-current-w1')).toBe('Published mode: default');
    });

    it.each([
        ['default', 'acceptEdits', 'safe-yolo'],
        ['acceptEdits', 'default', 'default'],
    ])('C5: published mode %s to %s invalidates an observation', async (initial, next, displayed) => {
        const s = await start();
        await s.apply('w1', { metadata: { permissionMode: initial } });
        await runtimeOutcome(30, initial);
        expect(s.textOf('ip-mode-current-w1')).toContain('Confirmed mode');
        await s.apply('w1', { metadata: { permissionMode: next } });
        expect(s.textOf('ip-mode-current-w1')).toBe(`Published mode: ${displayed}`);
        // Returning to the old published value cannot resurrect its old confirmation.
        await s.apply('w1', { metadata: { permissionMode: initial } });
        expect(s.textOf('ip-mode-current-w1')).toContain('Published mode');
        await runtimeOutcome(31, next);
        expect(s.textOf('ip-mode-current-w1')).toBe(`Confirmed mode: ${displayed}`);
    });

    it('C5: before_next_prompt is not a screen-verified permission result', async () => {
        const s = await start();
        await runtimeOutcome(30, 'acceptEdits', { timing: 'before_next_prompt' });
        expect(s.textOf('ip-mode-current-w1')).toBe('Published mode: default');
    });

    it('C5: mixed applied changes may omit timing while retaining a verified effective mode', async () => {
        const s = await start();
        await runtimeOutcome(30, 'acceptEdits', { timing: null, changes: [
            { key: 'permissionMode', requested: 'acceptEdits', effective: 'acceptEdits' },
            { key: 'model', requested: 'model-example', effective: 'model-example' },
        ] });
        expect(s.textOf('ip-mode-current-w1')).toBe('Confirmed mode: safe-yolo');
    });

    it('C5: message-updated observes an already-effective mode without loading history', async () => {
        const s = await start();
        await runtimeOutcome(30, 'acceptEdits', { type: 'message-updated', timing: 'skipped_already_effective' });
        expect(s.textOf('ip-mode-current-w1')).toBe('Confirmed mode: safe-yolo');
        expect(noTranscript).not.toHaveBeenCalled();
    });

    function encryptedWorker() {
        updateSession({ encryptionMode: 'e2ee' });
        const crypto = new SecretBoxEncryption(new Uint8Array(32).fill(1));
        const cache = new EncryptionCache();
        const encryption = new SessionEncryption('w1', crypto, cache);
        vi.mocked(sync.encryption.getSessionEncryption).mockReturnValue(encryption);
        return { crypto, cache };
    }

    it('C5: observing an encrypted outcome does not retain its record in the shared message cache', async () => {
        const s = await start();
        const { cache } = encryptedWorker();
        const before = cache.getStats();
        await runtimeOutcome(30, 'acceptEdits');
        expect(s.textOf('ip-mode-current-w1')).toBe('Confirmed mode: safe-yolo');
        expect(cache.getStats()).toEqual(before);
    });

    it.each(['new-message', 'message-updated'] as const)('C5: hung observer decrypt cannot delay %s projection, settlement or a newer message', async (type) => {
        const s = await start();
        const { crypto } = encryptedWorker();
        const entered = createDeferred<void>();
        const release = createDeferred<void>();
        const decrypt = crypto.decrypt.bind(crypto);
        vi.spyOn(crypto, 'decrypt').mockImplementationOnce(async (...args) => {
            entered.resolve();
            await release.promise;
            return decrypt(...args);
        });
        const first = await prepareRuntimeOutcome(30, 'default', { type });
        const second = await prepareRuntimeOutcome(31, 'acceptEdits');
        await act(async () => {
            const pending = first();
            await entered.promise;
            try {
                await settleReceivedSessionMessages('w1');
                expect(knownRemoteSeq).toHaveBeenCalledWith('w1', 30);
                await second();
                expect(knownRemoteSeq).toHaveBeenCalledWith('w1', 31);
            } finally {
                release.resolve();
                await pending;
            }
        });
        expect(s.textOf('ip-mode-current-w1')).toBe('Confirmed mode: safe-yolo');
        expect(noTranscript).not.toHaveBeenCalled();
    });

    it('C5: a rejecting decrypt logs no content and preserves record-only projection routing', async () => {
        const s = await start();
        const { crypto } = encryptedWorker();
        vi.spyOn(crypto, 'decrypt').mockRejectedValueOnce(new Error('private-event-content'));
        const deliver = await prepareRuntimeOutcome(30, 'acceptEdits');
        await act(async () => { await expect(deliver()).resolves.toBeUndefined(); });
        expect(knownRemoteSeq).toHaveBeenCalledWith('w1', 30);
        expect(socketLog).toHaveBeenCalled();
        expect(JSON.stringify(socketLog.mock.calls)).not.toContain('private-event-content');
        expect(s.textOf('ip-mode-current-w1')).toBe('Published mode: default');
        expect(noTranscript).not.toHaveBeenCalled();
    });

    it.each(['released', 'released-and-registered', 'twice-released-and-registered', 'published-changed'] as const)(
        'C5: pending decrypt cannot confirm after its observation scope is %s', async (lifecycle) => {
            let s = await start();
            const { crypto } = encryptedWorker();
            const entered = createDeferred<void>();
            const release = createDeferred<void>();
            const decrypt = crypto.decrypt.bind(crypto);
            vi.spyOn(crypto, 'decrypt').mockImplementationOnce(async (...args) => {
                entered.resolve();
                await release.promise;
                return decrypt(...args);
            });
            const deliver = await prepareRuntimeOutcome(30, 'acceptEdits');
            const pending = deliver();
            await entered.promise;
            if (lifecycle === 'published-changed') {
                await s.apply('w1', { metadata: { permissionMode: 'bypassPermissions' } });
            } else {
                await s.dispose();
                scenario = null;
                if (lifecycle !== 'released') s = await start();
                if (lifecycle === 'twice-released-and-registered') {
                    await s.dispose();
                    scenario = null;
                    s = await start();
                }
            }
            await act(async () => { release.resolve(); await pending; });
            if (lifecycle === 'released') s = await start();
            expect(s.textOf('ip-mode-current-w1')).toContain('Published mode');
            await runtimeOutcome(31, 'default');
            expect(s.textOf('ip-mode-current-w1')).toBe('Confirmed mode: default');
        },
    );

    it('C5: post-decrypt record-consumer check rejects when registrations disappear independently', async () => {
        const s = await start();
        const { crypto } = encryptedWorker();
        const entered = createDeferred<void>();
        const release = createDeferred<void>();
        const decrypt = crypto.decrypt.bind(crypto);
        vi.spyOn(crypto, 'decrypt').mockImplementationOnce(async (...args) => {
            entered.resolve();
            await release.promise;
            return decrypt(...args);
        });
        const deliver = await prepareRuntimeOutcome(30, 'acceptEdits');
        const pending = deliver();
        await entered.promise;
        // Registry scope reset can remove demand without unmounting the desk's observation owner.
        clearMountedSessionRealtimeRecordConsumers();
        await act(async () => { release.resolve(); await pending; });
        expect(s.textOf('ip-mode-current-w1')).toBe('Published mode: default');
        const unregister = registerSessionRealtimeRecordConsumer('w1');
        try {
            await runtimeOutcome(31, 'acceptEdits');
            expect(s.textOf('ip-mode-current-w1')).toBe('Confirmed mode: safe-yolo');
        } finally { unregister(); }
    });

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
        await s.screen.pressByTestIdAsync('ip-waiting-toggle-r1');
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
        await s.screen.pressByTestIdAsync('ip-waiting-toggle-transcript-request');
        expect(s.screen.findByTestId('ip-waiting-allow-transcript-request')).not.toBeNull();
    });
});

// These scenarios exercise the concurrent desktop panes. Phone navigation has its own tests.
vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock({ useWindowDimensions: () => ({ width: 1440, height: 900, scale: 1, fontScale: 1 }) });
});
