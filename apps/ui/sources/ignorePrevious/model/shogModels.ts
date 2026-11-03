import * as React from 'react';
import type { ModelOption } from '@/sync/domains/models/modelOptions';
import { useDeskPref } from '../deskPrefs';

export type ShogProvider = 'claude' | 'codex';
export type ShogModelSelection = Readonly<{ provider: ShogProvider; modelId: string }>;
export type ShogModel = ShogModelSelection & Readonly<{ label: string; option?: ModelOption }>;
export const firstShogModel: ShogModelSelection = { provider: 'claude', modelId: 'claude-opus-5-5' };
export const shogModelKey = (model: ShogModelSelection) => `${model.provider}:${model.modelId}`;

function parseModelKey(value: string): ShogModelSelection | null {
    const separator = value.indexOf(':');
    const provider = value.slice(0, separator);
    const modelId = value.slice(separator + 1).trim();
    return separator > 0 && (provider === 'claude' || provider === 'codex') && modelId
        ? { provider, modelId } : null;
}

export function enabledShogModels(models: readonly ShogModel[], enabled: readonly string[]): readonly ShogModel[] {
    return models.filter(model => enabled.includes(shogModelKey(model)));
}

export function useShogModelPreferences() {
    const [storedEnabled, setEnabled] = useDeskPref('shogModels');
    const [storedLastUsed, setLastUsed] = useDeskPref('shogLastUsedModel');
    const enabled = React.useMemo<readonly string[]>(() => {
        try {
            const parsed: unknown = JSON.parse(storedEnabled);
            return Array.isArray(parsed) ? [...new Set(parsed.filter((value): value is string => typeof value === 'string' && parseModelKey(value) !== null))] : [];
        } catch { return []; }
    }, [storedEnabled]);
    const lastUsed = React.useMemo(() => parseModelKey(storedLastUsed) ?? firstShogModel, [storedLastUsed]);
    const toggle = (key: string) => {
        if (!parseModelKey(key)) return;
        setEnabled(JSON.stringify(enabled.includes(key) ? enabled.filter(value => value !== key) : [...enabled, key]));
    };
    const remember = (model: ShogModelSelection) => setLastUsed(shogModelKey(model));
    return { enabled, lastUsed, toggle, remember };
}
