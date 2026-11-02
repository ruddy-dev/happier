import * as React from 'react';
import { useNewSessionPreflightModelsState } from '@/components/sessions/new/hooks/screenModel/useNewSessionPreflightModelsState';
import type { ShogModel } from './shogModels';

export type ShogModelProbeTarget = Readonly<{ machineId: string | null; serverId: string; cwd: string | null }>;
const claudeTarget = { kind: 'builtInAgent', agentId: 'claude' } as const;
const codexTarget = { kind: 'builtInAgent', agentId: 'codex' } as const;

/** CLI discovery and its existing cache own availability; the desk only filters it. */
export function useShogModelCatalog(target: ShogModelProbeTarget, enabled: boolean) {
    const params = { enabled, selectedMachineId: target.machineId, capabilityServerId: target.serverId, cwd: target.cwd };
    const claude = useNewSessionPreflightModelsState({ ...params, backendTarget: claudeTarget });
    const codex = useNewSessionPreflightModelsState({ ...params, backendTarget: codexTarget });
    const models = React.useMemo<readonly ShogModel[]>(() => [
        ...claude.modelOptions.filter(() => claude.probe.refreshedAt !== null).filter(option => claude.preflightModels?.availableModels.some(model => model.id === option.value))
            .map(option => ({ provider: 'claude' as const, modelId: option.value, label: option.label, option })),
        ...codex.modelOptions.filter(() => codex.probe.refreshedAt !== null).filter(option => codex.preflightModels?.availableModels.some(model => model.id === option.value))
            .map(option => ({ provider: 'codex' as const, modelId: option.value, label: option.label, option })),
    ], [claude.modelOptions, claude.preflightModels, claude.probe.refreshedAt, codex.modelOptions, codex.preflightModels, codex.probe.refreshedAt]);
    return { models, claude, codex };
}
