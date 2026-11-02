import * as React from 'react';
import Module from 'node:module';
import { apiSocket } from '@/sync/api/session/apiSocket';
import { FeaturesResponseSchema, buildBackendTargetKey } from '@happier-dev/protocol';
import * as registryUi from '@/agents/registry/registryUi';
import { act } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { renderScreen, standardCleanup } from '@/dev/testkit';
import { createSessionFixture } from '@/dev/testkit/fixtures/sessionFixtures';
import { createMachineFixture } from '@/dev/testkit/fixtures/machineFixtures';
import { storage } from '@/sync/domains/state/storage';
import { t } from '@/text';
import { AppPaneProvider } from '@/components/appShell/panes/AppPaneProvider';
import { AgentInput } from '@/components/sessions/agentInput/AgentInput';
import type { AgentInputChipPickerOption } from '@/components/sessions/agentInput/components/AgentInputChipPickerTypes';
import { SessionView } from '@/components/sessions/shell/SessionView';
import type { SessionComposerHostControls } from '@/components/sessions/model/sessionComposerOverrides';
import { buildServerFeaturesResponse } from '@/hooks/server/serverFeaturesTestUtils';
import { getServerFeaturesSnapshot, resetServerFeaturesClientForTests } from '@/sync/api/capabilities/serverFeaturesClient';
import { upsertAndActivateServer, getActiveServerSnapshot } from '@/sync/domains/server/serverRuntime';
import { existingSessionDraftSemanticValues } from '@/sync/domains/input/drafts/existingSessionDraftSemanticValues';
import { getActiveServerAccountScope } from '@/sync/domains/scope/activeServerAccountScope';
import { useDeskComposerControls } from '../model/useDeskComposerControls';

// Native/navigation/auth are host boundaries. Store, picker, composer send,
// metadata construction, capability admission and transition orchestration stay real.
vi.mock('react-native-unistyles', async () => (await import('@/dev/testkit/mocks/unistyles')).createUnistylesMock());
vi.mock('expo-router', async () => (await import('@/dev/testkit/mocks/router')).createExpoRouterMock().module);
vi.mock('@react-navigation/native', () => ({ useIsFocused: () => true, useFocusEffect: () => {}, useNavigation: () => ({ setOptions: () => {}, addListener: () => () => {}, isFocused: () => true, canGoBack: () => false }) }));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
vi.mock('@/auth/context/AuthContext', () => ({ useAuth: () => ({ credentials: null }) }));
vi.mock('@/sync/http/client', async importOriginal => ({ ...(await importOriginal<typeof import('@/sync/http/client')>()), serverFetch: async () => new Response(JSON.stringify(serverFeatures), { status: 200, headers: { 'content-type': 'application/json' } }) }));
vi.mock('@/modal', async () => (await import('@/dev/testkit/mocks/modal')).createModalModuleMock().module);
const rpc = vi.hoisted(() => vi.fn());
vi.mock('@/sync/runtime/orchestration/serverScopedRpc/serverScopedMachineRpc', () => ({ machineRpcWithServerScope: (request: unknown) => rpc(request) }));

let serverFeatures: ReturnType<typeof buildServerFeaturesResponse>;
let support: boolean | undefined;
let controls: SessionComposerHostControls;
const sessionId = 'handoff-test';
const machineId = 'handoff-machine';
const draft = 'Keep this exact draft';
const permissionModes = { claude: 'plan', codex: 'read-only' } as const;
function Host({ desk }: { desk: boolean }) {
    const deskControls = useDeskComposerControls(sessionId);
    return <AppPaneProvider><SessionView id={sessionId} surfaceFocusedOverride={true} composer={{
        ...(desk ? deskControls : {}),
        renderFooterLeadingActions: value => { controls = value; return null; },
    }} /></AppPaneProvider>;
}
beforeEach(() => {
    // Resolve the real lazy UI registry through Vitest's asset loader.
    const loader = Module as unknown as { _load: (id: string, ...args: unknown[]) => unknown };
    const originalLoad = loader._load;
    vi.spyOn(loader, '_load').mockImplementation((id, ...args) => id === '@/agents/registry/registryUi' ? registryUi : originalLoad(id, ...args));
    vi.spyOn(apiSocket, 'request').mockImplementation(async path => {
        if (!path.includes('/pending')) throw new Error(`Unexpected source request: ${path}`);
        return new Response(JSON.stringify({ pending: [] }), { status: 200 });
    });
    support = true;
    upsertAndActivateServer({ serverUrl: 'http://localhost:53289', scope: 'tab' });
    storage.setState({ profileScope: { serverId: getActiveServerSnapshot().serverId, accountId: 'test-account' } });
    existingSessionDraftSemanticValues.clear(getActiveServerAccountScope()!, sessionId, 'routing.agentContinuation');
    const features = serverFeatures = buildServerFeaturesResponse({ automationsEnabled: false, connectedServicesEnabled: false });
    features.features.sessions.enabled = true;
    features.features.sessions.agentSwitching.enabled = true;
    FeaturesResponseSchema.parse(features);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(features), { status: 200, headers: { 'content-type': 'application/json' } })));
    resetServerFeaturesClientForTests();
    rpc.mockReset();
    rpc.mockImplementation(async (request: { method: string; payload: { selections?: unknown[] } }) => {
        if (request.method === 'capabilities.detect') return { protocolVersion: 1, results: {
            'tool.sessionAgentTransition': { ok: true, checkedAt: 1, data: { supportsInputPermissionIntent: support } },
        } };
        if (request.method === 'session.continuation.inspect') return { type: 'available', protocolVersion: 1, sameSessionTransition: true };
        if (request.method === 'session.agentTransition') return { type: 'rejected', code: 'target_unavailable', sourceEffect: 'none' };
        return { v: 1, inspections: (request.payload.selections ?? []).map(() => ({ type: 'available', protocolVersion: 1, sameSessionTransition: true })) };
    });
    storage.getState().applySettingsLocal({ experiments: true, featureToggles: { 'sessions.agentSwitching': true } });
    storage.getState().applyMachines([createMachineFixture({ id: machineId, active: true, activeAt: Date.now() })]);
    storage.getState().applyReady();
});
afterEach(async () => { await standardCleanup(); vi.unstubAllGlobals(); resetServerFeaturesClientForTests(); });

async function setup(source: 'claude' | 'codex', desk = true, explicit = true) {
    storage.setState({ sessions: { [sessionId]: createSessionFixture({ id: sessionId, encryptionMode: 'plain', active: true, activeAt: Date.now(), seq: 1,
        permissionMode: permissionModes[source],
        metadata: { path: '/scratch', host: 'test', machineId, flavor: source, permissionMode: permissionModes[source], permissionModeUpdatedAt: 1 },
    }) } });
    expect((await getServerFeaturesSnapshot()).status).toBe('ready');
    const screen = await renderScreen(<Host desk={desk} />);
    await act(async () => { controls.agentPicker.onAgentPickerIntent(); });
    const target: 'claude' | 'codex' = source === 'claude' ? 'codex' : 'claude';
    expect(controls.switchingEnabled, 'server gate').toBe(true);
    expect([...controls.agentPicker.continuationAvailability], 'eligible rail').toContainEqual([buildBackendTargetKey({ kind: 'builtInAgent', agentId: target }), 'eligible']);
    await act(async () => { await controls.agentPicker.selectAgentForNextMessage(buildBackendTargetKey({ kind: 'builtInAgent', agentId: target }), {
        modelId: 'default', modelLabel: null, sessionModeId: null, configOverrides: {},
        ...(explicit ? { inputPermissionMode: permissionModes[target] } : {}),
    }); });
    expect(controls.agentId).toBe(source);
    expect(controls.agentPicker.armedContinuation?.selection.agentId).toBe(target);
    await act(async () => { controls.textStore.setPrompt(draft); });
    return { screen, target };
}

it.each(['claude', 'codex'] as const)('dispatches the actual SessionView %s arm with the target permission', async source => {
    const { target } = await setup(source);
    expect(controls.agentPicker.armedContinuation).not.toBeNull();
    await act(async () => { controls.sendMessage(draft); });
    const calls = rpc.mock.calls.map(([request]) => request).filter(request => request.method === 'session.agentTransition');
    expect(calls).toHaveLength(1);
    expect(calls[0].payload.input.meta.permissionMode).toBe(permissionModes[target]);
});


it.each(['claude', 'codex'] as const)('refuses a desk %s arm without explicit intent and preserves the draft', async source => {
    const { screen, target } = await setup(source, true, false);
    expect(controls.agentPicker.armedContinuation?.selection.agentId).toBe(target);
    await screen.unmount();
    await renderScreen(<Host desk={true} />);
    await act(async () => { controls.agentPicker.onAgentPickerIntent(); });
    expect(controls.agentId).toBe(source);
    expect(controls.agentPicker.armedContinuation?.selection.agentId).toBe(target);
    await act(async () => { controls.textStore.setPrompt(draft); });
    await act(async () => { controls.sendMessage(draft); });
    expect(rpc.mock.calls.some(([request]) => request.method === 'session.agentTransition')).toBe(false);
    expect(controls.textStore.getPrompt()).toBe(draft);
    expect(controls.continuationNotice).toBeTruthy();
    expect(vi.mocked(apiSocket.request).mock.calls.every(([, init]) => init?.method === 'GET')).toBe(true);
});

it.each(['claude', 'codex'] as const)('checks equivalent intent support at the final SessionView %s send', async source => {
    const { target } = await setup(source);
    // Source metadata already commits the TARGET intent. Equivalence cannot skip the probe.
    await act(async () => { storage.setState({ sessions: { [sessionId]: { ...storage.getState().sessions[sessionId]!,
        metadata: { ...storage.getState().sessions[sessionId]!.metadata!, permissionMode: permissionModes[target] },
    } } }); });
    support = undefined;
    await act(async () => { controls.sendMessage(draft); });
    expect(rpc.mock.calls.some(([request]) => request.method === 'session.agentTransition')).toBe(false);
    expect(controls.textStore.getPrompt()).toBe(draft);
});

it('preserves ordinary non-desk legacy arm behavior and stock cross-provider choices', async () => {
    const { screen } = await setup('claude', false, false);
    const compose = screen.findByType(AgentInput).props.composeAgentPickerOptions;
    expect(compose([{ id: 'current', label: 'Current' }]).some((option: AgentInputChipPickerOption) => option.id !== 'current')).toBe(true);
    await act(async () => { controls.sendMessage(draft); });
    const calls = rpc.mock.calls.map(([request]) => request).filter(request => request.method === 'session.agentTransition');
    expect(calls).toHaveLength(1);
    expect(calls[0].payload.input.meta.permissionMode).toBe('plan');
});

it.each(['claude', 'codex'] as const)('keeps the stock picker within the current provider on the %s desk', async source => {
    const { screen } = await setup(source);
    const compose = screen.findByType(AgentInput).props.composeAgentPickerOptions;
    const current = [{ id: 'current', label: 'Current' }];
    expect(compose ? compose(current) : current).toEqual(current);
});

it.each(['claude', 'codex'] as const)('refuses a restored %s arm carrying the wrong target intent', async source => {
    const { screen } = await setup(source);
    const scope = getActiveServerAccountScope()!;
    const arm = existingSessionDraftSemanticValues.read(scope, sessionId, 'routing.agentContinuation')!;
    await screen.unmount();
    existingSessionDraftSemanticValues.write(scope, sessionId, 'routing.agentContinuation', { ...arm, inputPermissionMode: permissionModes[source] });
    await renderScreen(<Host desk={true} />);
    await act(async () => { controls.agentPicker.onAgentPickerIntent(); controls.textStore.setPrompt(draft); });
    expect(controls.agentPicker.armedContinuationPermissionMode).toBe(permissionModes[source]);
    await act(async () => { controls.sendMessage(draft); });
    expect(rpc.mock.calls.some(([request]) => request.method === 'session.agentTransition')).toBe(false);
    expect(controls.textStore.getPrompt()).toBe(draft);
    expect(controls.continuationNotice).toBeTruthy();
});

it.each(['claude', 'codex'] as const)('refuses a settled %s retry whose retained wire input contradicts the target permission', async source => {
    const { screen, target } = await setup(source);
    const sourceSend = vi.spyOn(apiSocket, 'send');
    const sourceAck = vi.spyOn(apiSocket, 'emitWithAck');
    const localId = controls.agentPicker.armedContinuationLocalId!;
    const originalInput = { localId, text: 'Original input', meta: { permissionMode: permissionModes[source] } };
    const machineRpc = rpc.getMockImplementation()!;
    let restored = false;
    rpc.mockImplementation(async request => {
        if (!restored && request.method === 'session.agentTransition') {
            // Restore an older wire snapshot while the real send is pending.
            // A live rejected result must settle before the retry, otherwise
            // remount reconciliation can hold the composer before its guard.
            restored = true;
            expect(controls.agentPicker.recordArmedContinuationSubmission({ localId, input: originalInput })).toBe(true);
        }
        return machineRpc(request);
    });
    await act(async () => { controls.sendMessage(draft); });
    const transitions = () => rpc.mock.calls.map(([request]) => request).filter(request => request.method === 'session.agentTransition');
    expect(restored).toBe(true);
    expect(transitions()).toHaveLength(1);
    expect(transitions()[0].payload.input.meta.permissionMode).toBe(permissionModes[target]);
    expect(controls.continuationNotice).toBe(t('session.agentContinuation.transition.rejected.targetUnavailable', {
        agent: target === 'claude' ? 'Claude' : 'Codex',
    }));
    expect(screen.findByType(AgentInput).props.isSending).toBe(false);
    expect(controls.canSend).toBe(true);
    expect(controls.agentPicker.armedContinuationPermissionMode).toBe(permissionModes[target]);
    const submission = controls.agentPicker.armedContinuationSubmission;
    expect(submission?.input).toEqual(originalInput);

    await act(async () => { controls.sendMessage(draft); });
    expect(controls.continuationNotice, 'settled retry must refuse the retained source-permission input').toBe(
        t('session.agentContinuation.transition.rejected.unsupportedOperation'),
    );
    expect(controls.textStore.getPrompt()).toBe(draft);
    expect(controls.agentPicker.armedContinuationSubmission).toEqual(submission);
    expect(existingSessionDraftSemanticValues.read(getActiveServerAccountScope()!, sessionId, 'routing.agentContinuation')?.submission).toEqual(submission);
    expect(controls.agentPicker.armedContinuationPermissionMode).toBe(permissionModes[target]);
    expect(controls.agentId).toBe(source);
    expect(transitions()).toHaveLength(1);
    expect(vi.mocked(apiSocket.request).mock.calls.every(([, init]) => init?.method === 'GET')).toBe(true);
    expect(sourceSend.mock.calls.filter(([event]) => event === 'message')).toHaveLength(0);
    expect(sourceAck.mock.calls.filter(([event]) => event === 'message')).toHaveLength(0);
});
