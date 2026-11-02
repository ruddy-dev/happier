import { getAgentStaticModels } from '@happier-dev/agents';
import { computeSessionConfigOptionControlsForProvider } from '@/sync/domains/sessionControl/configOptionsControl';

export type DeskModel = 'default' | 'claude-opus-5-5' | 'claude-sonnet-5-5' | 'claude-haiku-5-5' | 'claude-fable-5-1';
export type DeskEffort = 'low' | 'medium' | 'high' | 'xhigh';
export type RunSettings = Readonly<{ model: DeskModel; effort: DeskEffort; ultracode: boolean; permissionMode: 'plan' }>;
export type RunSettingsAction = { type: 'model'; model: DeskModel } | { type: 'effort'; effort: DeskEffort } | { type: 'ultracode'; enabled: boolean };
export const initialRunSettings: RunSettings = { model: 'claude-opus-5-5', effort: 'high', ultracode: false, permissionMode: 'plan' };
// The desk deliberately offers fewer models than the provider catalog (M10).
export function offersUltracode(model: string): boolean {
    return ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-fable-5-1'].includes(model)
        && getAgentStaticModels('claude').some(entry => entry.id === model && entry.modelOptions?.some(option => option.id === 'ultracode'));
}
export function runEffortControl(state: RunSettings) {
    const controls = computeSessionConfigOptionControlsForProvider({
        providerId: 'claude',
        configOptions: [
            { id: 'reasoning_effort', name: 'Effort', type: 'select', currentValue: state.effort },
            { id: 'ultracode', name: 'Ultracode', type: 'boolean', currentValue: String(state.ultracode) },
        ],
    });
    const effort = controls!.find(control => control.option.id === 'reasoning_effort')!;
    // The shared owner supplies locking; the desk projects the documented forced value.
    return { ...effort, effectiveValue: effort.disabled ? 'xhigh' as const : state.effort };
}
export function runSettingsReducer(state: RunSettings, action: RunSettingsAction): RunSettings {
    switch (action.type) {
        case 'model':
            return action.model === state.model ? state : { ...state, model: action.model, ultracode: state.ultracode && offersUltracode(action.model) };
        case 'effort':
            return runEffortControl(state).disabled || state.effort === action.effort ? state : { ...state, effort: action.effort };
        case 'ultracode': {
            const enabled = action.enabled && offersUltracode(state.model);
            return enabled === state.ultracode ? state : { ...state, ultracode: enabled };
        }
    }
}
