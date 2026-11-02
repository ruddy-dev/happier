import * as React from 'react';
import { buildBackendTargetKey } from '@happier-dev/protocol';
import { act } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { renderScreen, renderHook, standardCleanup } from '@/dev/testkit';
import { storage } from '@/sync/domains/state/storage';
import { t } from '@/text';
import { useInSessionAgentPickerControls } from '@/components/sessions/agentPicker/useInSessionAgentPickerControls';
import { getResolvedBackendCatalogEntries } from '@/agents/backendCatalog/getResolvedBackendCatalogEntries';
import type { SessionComposerHostControls } from '@/components/sessions/model/sessionComposerOverrides';
import { createComposerTextStore } from '@/components/sessions/agentInput/composerTextStore';
import { continueSessionWithArmedAgent } from '@/sync/domains/session/input/continueSessionWithArmedAgent';
import { submitSessionUserMessage } from '@/sync/domains/session/input/submitSessionUserMessage';
import { createSessionFixture } from '@/dev/testkit/fixtures/sessionFixtures';
import { readReactNativeMmkvStubEntries } from '@/dev/testkit/mocks/mmkv';
import { ShogRunSettingsMenu } from './ShogRunSettingsMenu';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('@/sync/runtime/orchestration/serverScopedRpc/serverScopedMachineRpc', () => ({ machineRpcWithServerScope: (request: unknown) => rpc(request) }));
vi.mock('react-native', async () => {
    const { createReactNativeNativeMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeNativeMock({ platformOS: 'ios' });
});
vi.mock('@/hooks/ui/useReducedMotionPreference', async () => {
    const { createReducedMotionModuleMock } = await import('@/dev/testkit/mocks/reducedMotion');
    return createReducedMotionModuleMock(true);
});
const AVAILABLE = { type: 'available', protocolVersion: 1, sameSessionTransition: true } as const;
let permissionSupport: boolean | undefined;
let featureEnabled: boolean;
let transitionRejected: boolean;

beforeEach(() => {
    permissionSupport = true;
    featureEnabled = true;
    transitionRejected = false;
    rpc.mockReset();
    rpc.mockImplementation(async (request: { method: string; payload: { id?: string; selections?: readonly unknown[] } }) => {
        if (request.method === 'capabilities.detect') return { protocolVersion: 1, results: {
            'tool.sessionAgentTransition': { ok: true, checkedAt: 1, data: { supportsInputPermissionIntent: permissionSupport } },
        } };
        if (request.method === 'capabilities.invoke') return { ok: true, result: {
            availableModels: request.payload.id === 'cli.codex'
                ? [{ id: 'gpt-6.1-sol', name: 'Sol', modelOptions: [{ id: 'reasoning_effort', name: 'Thinking', type: 'select', currentValue: 'medium', options: [{ value: 'medium', name: 'Medium' }, { value: 'high', name: 'High' }] }] }, { id: 'gpt-6-astra', name: 'Astra' }, { id: 'unticked', name: 'Unticked' }]
                : [{ id: 'claude-opus-5-5', name: 'Opus 5.5' }], supportsFreeform: false, source: 'dynamic', observedAt: Date.now(),
        } };
        if (request.method === 'session.agentTransition') return transitionRejected ? { type: 'rejected', code: 'target_unavailable', sourceEffect: 'none' } : { type: 'accepted', localId: 'rebrief-1' };
        return { v: 1, inspections: (request.payload.selections ?? []).map(() => AVAILABLE) };
    });
});
afterEach(standardCleanup);

async function setup(provider: 'claude' | 'codex' = 'claude', busy = false) {
    const session = createSessionFixture({ id: 'shog-test', active: true, thinking: busy, pendingVersion: 2, pendingCount: 0,
        metadata: { path: '/scratch', host: 'test', machineId: 'shog-machine', flavor: provider } });
    storage.setState({ sessions: { [session.id]: session } });
    const hook = await renderHook(() => useInSessionAgentPickerControls({
        sessionId: session.id, accountScope: null, currentAgentId: provider, currentAgentLabel: provider,
        entries: getResolvedBackendCatalogEntries({ acpCatalogSettingsV1: storage.getState().settings.acpCatalogSettingsV1, enabledAgentIds: ['claude', 'codex'] }),
        featureDecision: { state: featureEnabled ? 'enabled' : 'disabled' },
        source: { currentBackendTargetKey: buildBackendTargetKey({ kind: 'builtInAgent', agentId: provider }), storageKind: 'persisted', canEditSession: true, machinePresence: 'online', hasConversationToCarry: true },
        machine: { machineId: 'shog-machine', serverId: 'server-1', connectionGeneration: 1, daemonGeneration: 1 },
        detail: { settings: storage.getState().settings, machineId: 'shog-machine', capabilityServerId: 'server-1', cwd: '/scratch' },
    }));
    const sent: string[] = [];
    // These are the canonical submit owner's outward transport ports. Its routing,
    // busy policy and storage reads remain real; no internal send logic is mocked.
    const pendingSends: Promise<unknown>[] = [];
    let continuationNotice: string | null = null;
    const send = (text: string) => {
        const arm = hook.getCurrent().armedContinuation;
        if (arm) {
            pendingSends.push(continueSessionWithArmedAgent({ machineId: 'shog-machine', serverId: 'server-1', sessionId: session.id, localId: 'rebrief-1', intent: arm, input: { text, meta: { permissionMode: hook.getCurrent().armedContinuationPermissionMode } }, sourceAgentLabel: provider, targetAgentLabel: arm.selection.agentId }, { requireInputPermissionIntentSupport: true }).then(outcome => { continuationNotice = outcome.disposition.notice?.message ?? null; }));
            return;
        }
        pendingSends.push(submitSessionUserMessage({
        enqueuePendingMessage: async (_id, message) => { sent.push(message); return { accepted: true, localId: 'rebrief-1' }; },
        sendMessage: async (_id, message) => { sent.push(message); return { localId: 'rebrief-1', seq: 2, persistence: 'transcript_committed' }; },
        isMachineReachable: () => true,
        shouldDelegatePendingActivationToDaemon: async () => false,
        ensureSessionRuntimeForPendingInput: async () => ({ type: 'success' }),
        refreshSessionForSubmit: async () => session,
    }, { session, sessionId: session.id, text, configuredMode: 'server_pending', resumeCapabilityOptions: { accountSettings: storage.getState().settings } })); };
    const configChanges: [string, string][] = [];
    const textStore = createComposerTextStore('');
    const controls = (): SessionComposerHostControls => ({
        agentId: provider, modelId: provider === 'claude' ? 'claude-opus-5-5' : 'gpt-6.1-sol', configOverrides: {},
        machineId: 'shog-machine', serverId: 'server-1', cwd: '/scratch', canSend: true, busy,
        textStore, hasNonTextDraft: false, continuationNotice, switchingEnabled: featureEnabled, agentPicker: hook.getCurrent(), setModel: () => {}, setConfigOption: (key, value) => { configChanges.push([key, value]); }, sendMessage: send,
    });
    const screen = await renderScreen(<ShogRunSettingsMenu controls={controls()} />);
    await screen.pressByTestIdAsync('ip-run-settings');
    await screen.update(<ShogRunSettingsMenu controls={controls()} />);
    return { screen, hook, sent, controls, configChanges, textStore, settleSends: () => Promise.all(pendingSends) };
}

it.each([['claude', 'codex', 'gpt-6.1-sol', 'read-only'], ['codex', 'claude', 'claude-opus-5-5', 'plan']] as const)(
    'lists ticked CLI models and arms %s to %s with %s / %s through the real picker', async (source, target, model, permission) => {
        const { screen, hook, sent, controls } = await setup(source);
        expect(screen.getTextContent()).not.toContain('Unticked');
        expect(screen.findByTestId(`ip-run-model-${target}-${model}`)?.props.disabled).toBe(false);
        await screen.pressByTestIdAsync(`ip-run-model-${target}-${model}`);
        await act(async () => { await Promise.resolve(); });
        expect(hook.getCurrent().armedContinuation?.selection).toMatchObject({ agentId: target, modelId: model });
        expect(hook.getCurrent().armedContinuationPermissionMode).toBe(permission);
        await screen.update(<ShogRunSettingsMenu controls={controls()} />);
        expect(screen.getTextContent()).toContain(t('ignorePrevious.shogModels.switchNextMessage', { provider: t(`ignorePrevious.shogModels.${target}`) }));
        expect(sent).toEqual([]);
    },
);

it.each([false, undefined])('shows switching unavailable and leaves the source unchanged with support %s', async support => {
    permissionSupport = support;
    const { screen, hook, sent } = await setup();
    expect(screen.getTextContent()).toContain(t('ignorePrevious.shogModels.switchUnavailable'));
    expect(screen.findByTestId('ip-run-model-codex-gpt-6.1-sol')?.props.disabled).toBe(true);
    expect(hook.getCurrent().armedContinuation).toBeNull();
    expect(sent).toEqual([]);
});

it.each(['claude', 'codex'] as const)('Re-brief on %s sends exactly one localized ordinary message and no prefs writes', async provider => {
    const { screen, sent, settleSends } = await setup(provider, true);
    const before = readReactNativeMmkvStubEntries();
    await screen.pressByTestIdAsync('ip-run-rebrief');
    await act(async () => { await settleSends(); });
    expect(sent).toEqual([t('ignorePrevious.shogModels.rebriefMessage')]);
    expect(readReactNativeMmkvStubEntries()).toEqual(before);
    expect(rpc.mock.calls.every(([request]) => request.method === 'capabilities.detect' || request.method === 'capabilities.invoke' || request.method.startsWith('session.continuation.inspect'))).toBe(true);
});

it('keeps switching disabled behind the relay feature decision', async () => {
    featureEnabled = false;
    const { screen, hook, sent } = await setup();
    expect(screen.getTextContent()).toContain(t('ignorePrevious.shogModels.switchUnavailable'));
    expect(screen.findByTestId('ip-run-model-codex-gpt-6.1-sol')?.props.disabled).toBe(true);
    expect(hook.getCurrent().armedContinuation).toBeNull();
    expect(sent).toEqual([]);
});

it('shows a rejected switch without changing the source model or sending to it', async () => {
    transitionRejected = true;
    const { screen, hook, sent, controls, settleSends } = await setup();
    await screen.pressByTestIdAsync('ip-run-model-codex-gpt-6.1-sol');
    await screen.update(<ShogRunSettingsMenu controls={controls()} />);
    await screen.pressByTestIdAsync('ip-run-rebrief');
    await act(async () => { await settleSends(); });
    await screen.pressByTestIdAsync('ip-run-settings');
    await screen.update(<ShogRunSettingsMenu controls={controls()} />);
    expect(controls().continuationNotice).toBeTruthy();
    expect(screen.getTextContent()).toContain(controls().continuationNotice);
    expect(controls().agentId).toBe('claude');
    expect(controls().modelId).toBe('claude-opus-5-5');
    expect(hook.getCurrent().armedContinuation?.selection.agentId).toBe('codex');
    expect(sent).toEqual([]);
});

it('offers only the GPT catalog effort levels and omits unsupported Ultracode', async () => {
    const { screen, configChanges } = await setup('codex');
    expect(screen.findByTestId('ip-run-effort-medium')).not.toBeNull();
    expect(screen.findByTestId('ip-run-effort-high')).not.toBeNull();
    expect(screen.findByTestId('ip-run-effort-max')).toBeNull();
    expect(screen.findByTestId('ip-run-ultracode')).toBeNull();
    await screen.pressByTestIdAsync('ip-run-effort-high');
    expect(configChanges).toEqual([['reasoning_effort', 'high']]);
});

it('uses an armed switch for Re-brief instead of sending to the source provider', async () => {
    const { screen, hook, sent, controls, settleSends } = await setup();
    await screen.pressByTestIdAsync('ip-run-model-codex-gpt-6.1-sol');
    await screen.update(<ShogRunSettingsMenu controls={controls()} />);
    expect(hook.getCurrent().armedContinuation).not.toBeNull();
    const before = readReactNativeMmkvStubEntries();
    await screen.pressByTestIdAsync('ip-run-rebrief');
    await act(async () => { await settleSends(); });
    const writes = rpc.mock.calls.map(([request]) => request).filter(request => request.method === 'session.agentTransition');
    expect(writes).toHaveLength(1);
    expect(writes[0].payload.input).toMatchObject({ text: t('ignorePrevious.shogModels.rebriefMessage'), meta: { permissionMode: 'read-only' } });
    expect(sent).toEqual([]);
    expect(readReactNativeMmkvStubEntries()).toEqual(before);
});

it('does not let Re-brief consume or send an existing composer draft', async () => {
    const { screen, textStore, sent } = await setup();
    await act(async () => { textStore.setPrompt('My unsent draft'); });
    expect(screen.findByTestId('ip-run-rebrief')?.props.disabled).toBe(true);
    await screen.pressByTestIdAsync('ip-run-rebrief');
    expect(sent).toEqual([]);
    expect(textStore.getPrompt()).toBe('My unsent draft');
    expect(screen.getTextContent()).toContain(t('ignorePrevious.shogModels.rebriefDraft'));
    await act(async () => { textStore.setPrompt(''); });
    expect(screen.findByTestId('ip-run-rebrief')?.props.disabled).toBe(false);
});
