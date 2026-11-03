import * as React from 'react';
import { buildBackendTargetKey } from '@happier-dev/protocol';
import type { SessionComposerHostControls } from '@/components/sessions/model/sessionComposerOverrides';
import { computeSessionConfigOptionControlsForProvider } from '@/sync/domains/sessionControl/configOptionsControl';
import { inspectInputPermissionIntentSupport } from '@/sync/domains/session/input/continueSessionWithArmedAgent';
import { t } from '@/text';
import { enabledShogModels, useShogModelPreferences, type ShogModel } from '../model/shogModels';
import { useShogModelCatalog } from '../model/useShogModelCatalog';
import type { RunSettingsAction } from '../model/runSettings';
import { RunSettingsMenu } from './RunSettingsMenu';

/** Binds the desk view to the composer's model, arm and ordinary-send owners. */
export function ShogRunSettingsMenu({ controls }: { controls: SessionComposerHostControls }) {
    const preferences = useShogModelPreferences();
    const hasTextDraft = React.useSyncExternalStore(controls.textStore.subscribe,
        () => controls.textStore.getPrompt().length > 0, () => controls.textStore.getPrompt().length > 0);
    const hasDraft = hasTextDraft || controls.hasNonTextDraft;
    const [demanded, setDemanded] = React.useState(false);
    const [capability, setCapability] = React.useState<{ scope: string; supported: boolean } | null>(null);
    const [pendingModel, setPendingModel] = React.useState<ShogModel | null>(null);
    const [pickRefused, setPickRefused] = React.useState(false);
    const catalog = useShogModelCatalog(controls, demanded);
    const scope = `${controls.serverId} ${controls.machineId} ${controls.probeGeneration ?? ''} ${controls.switchingEnabled}`;
    const currentScope = React.useRef(scope);
    currentScope.current = scope;
    const inputPermissionSupported = capability?.scope === scope && capability.supported;
    React.useEffect(() => {
        if (!demanded || !controls.switchingEnabled || !controls.machineId) return;
        let cancelled = false;
        void inspectInputPermissionIntentSupport(controls.machineId, controls.serverId).then(support => {
            if (!cancelled) setCapability({ scope, supported: support === 'supported' });
        });
        return () => { cancelled = true; };
    }, [controls.machineId, controls.serverId, controls.switchingEnabled, demanded, scope]);

    const armed = controls.agentPicker.armedContinuation;
    const provider = armed?.selection.agentId === 'codex' ? 'codex' : armed ? 'claude'
        : controls.agentId === 'codex' ? 'codex' : 'claude';
    const modelId = armed?.selection.modelId ?? controls.modelId;
    const model = catalog.models.find(candidate => candidate.provider === provider && candidate.modelId === modelId)
        ?? { provider, modelId, label: modelId };
    const overrides = armed ? Object.fromEntries(Object.entries(armed.selection.sessionConfigOptionOverrides?.overrides ?? {})
        .flatMap(([id, override]) => typeof override.value === 'string' ? [[id, override.value]] : [])) : controls.configOverrides;
    const options = model.option?.modelOptions ?? [];
    const configControls = computeSessionConfigOptionControlsForProvider({
        providerId: provider, configOptions: options,
        overrides: Object.fromEntries(Object.entries(overrides).map(([id, value]) => [id, { value }])),
    });
    const effort = configControls?.find(control => control.option.id === 'reasoning_effort');
    const ultracode = configControls?.find(control => control.option.id === 'ultracode');
    const offersUltracode = ultracode !== undefined;
    const settings = { model: modelId, effort: effort?.effectiveValue ?? '', ultracode: ultracode?.effectiveValue === 'true', permissionMode: armed ? controls.agentPicker.armedContinuationPermissionMode ?? null : provider === 'codex' ? 'read-only' as const : 'plan' as const };
    const models = enabledShogModels(catalog.models, preferences.enabled);
    const canPick = (choice: ShogModel) => controls.canSend && (choice.provider === controls.agentId
        || (controls.switchingEnabled && inputPermissionSupported && controls.agentPicker.continuationAvailability.get(buildBackendTargetKey({ kind: 'builtInAgent', agentId: choice.provider })) === 'eligible'));

    // A selection is only last USED once the canonical Session
    // echoes that provider/model. A rejected switch never changes this preference.
    React.useEffect(() => {
        if (pendingModel && controls.agentId === pendingModel.provider && controls.modelId === pendingModel.modelId) {
            preferences.remember(pendingModel);
            setPendingModel(null);
        }
    }, [controls.agentId, controls.modelId, pendingModel]);

    const arm = async (choice: ShogModel, configOverrides: Readonly<Record<string, string>>) => {
        const requestedScope = currentScope.current;
        const result = await controls.agentPicker.selectAgentForNextMessage(buildBackendTargetKey({ kind: 'builtInAgent', agentId: choice.provider }), {
            modelId: choice.modelId, modelLabel: choice.label, sessionModeId: null, configOverrides,
            inputPermissionMode: choice.provider === 'codex' ? 'read-only' : 'plan',
        });
        if (currentScope.current !== requestedScope) return;
        setPickRefused(result === 'unavailable');
        setPendingModel(result === 'unavailable' ? null : choice);
    };
    const pick = (choice: ShogModel) => {
        if (!canPick(choice)) { setPickRefused(true); return; }
        setPickRefused(false);
        if (choice.provider !== controls.agentId) { void arm(choice, {}); return; }
        controls.agentPicker.clearArmedContinuation();
        setPendingModel(choice);
        controls.setModel(choice.modelId, { preflight: catalog[choice.provider].preflightModels, preflightUpdatedAt: catalog[choice.provider].probe.refreshedAt });
        if (!choice.option?.modelOptions?.some(option => option.id === 'ultracode') && controls.configOverrides.ultracode === 'true') controls.setConfigOption('ultracode', 'false');
    };
    const change = (action: RunSettingsAction) => {
        if (!controls.canSend || action.type === 'model') return;
        if (action.type === 'effort' && (!effort || effort.disabled || !effort.option.options?.some(option => option.value === action.effort))) return;
        if (action.type === 'ultracode' && !offersUltracode) return;
        const configId = action.type === 'effort' ? 'reasoning_effort' : 'ultracode';
        const value = action.type === 'effort' ? action.effort : String(action.enabled);
        if (armed) void arm(model, { ...overrides, [configId]: value });
        else controls.setConfigOption(configId, value);
    };
    const unavailable = !controls.switchingEnabled || !inputPermissionSupported || pickRefused
        || (pendingModel && controls.agentPicker.continuationAvailability.get(buildBackendTargetKey({ kind: 'builtInAgent', agentId: pendingModel.provider })) === 'unavailable');
    const note = controls.continuationNotice ?? (unavailable ? t('ignorePrevious.shogModels.switchUnavailable')
        : armed ? t('ignorePrevious.shogModels.switchNextMessage', { provider: t(`ignorePrevious.shogModels.${provider}`) })
        : catalog.models.length === 0 ? t('ignorePrevious.shogModels.modelsUnavailable') : null);
    return <RunSettingsMenu midTurn={controls.busy} live={{
        settings, model, models, offersUltracode, canPick, pick, change,
        effort: { levels: effort?.option.options?.map(option => option.value) ?? [], disabled: !controls.canSend || !effort || effort.disabled === true, effectiveValue: settings.ultracode ? 'xhigh' : settings.effort },
        onOpen: () => { setDemanded(true); controls.agentPicker.onAgentPickerIntent(); }, note,
        rebriefNote: controls.agentPicker.armedContinuationSubmission ? t('ignorePrevious.shogModels.rebriefSubmission')
            : hasDraft ? t('ignorePrevious.shogModels.rebriefDraft') : null,
        canRebrief: controls.canSend && !hasDraft && !controls.agentPicker.armedContinuationSubmission,
        rebrief: () => {
            if (controls.canSend && !controls.agentPicker.armedContinuationSubmission && !controls.hasNonTextDraft && controls.textStore.getPrompt().length === 0) controls.sendMessage(t('ignorePrevious.shogModels.rebriefMessage'));
        },
    }} />;
}
