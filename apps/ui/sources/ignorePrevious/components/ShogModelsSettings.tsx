import * as React from 'react';
import { Pressable, View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { useActiveServerSnapshot } from '@/hooks/server/useActiveServerSnapshot';
import { t } from '@/text';
import { useDeskSessions } from '../useDeskSessions';
import { useCoordinatorId } from '../model/useCoordinatorId';
import { shogModelKey, useShogModelPreferences } from '../model/shogModels';
import { useShogModelCatalog } from '../model/useShogModelCatalog';
import { DeskText } from '../typography/DeskText';

export function ShogModelsSettings() {
    const { theme } = useUnistyles();
    const sessions = useDeskSessions();
    const coordinatorId = useCoordinatorId(sessions.list);
    const coordinator = coordinatorId ? sessions.lookup.get(coordinatorId) : null;
    const { serverId } = useActiveServerSnapshot();
    const catalog = useShogModelCatalog({
        machineId: coordinator?.metadata?.machineId ?? null,
        serverId: coordinator?.serverId ?? serverId,
        cwd: coordinator?.metadata?.path ?? null,
    }, true);
    const preferences = useShogModelPreferences();
    const lastUsed = catalog.models.find(model => shogModelKey(model) === shogModelKey(preferences.lastUsed));
    return <View style={{ gap: 8 }}>
        <DeskText accessibilityRole="header" style={{ color: theme.colors.text.primary }}>{t('ignorePrevious.shogModels.title')}</DeskText>
        <DeskText style={{ color: theme.colors.text.secondary }}>{t('ignorePrevious.shogModels.lastUsed', { model: lastUsed?.label ?? preferences.lastUsed.modelId })}</DeskText>
        {(['claude', 'codex'] as const).map(provider => <View key={provider} style={{ gap: 4 }}>
            <DeskText accessibilityRole="header" style={{ color: theme.colors.text.secondary }}>{t(`ignorePrevious.shogModels.${provider}`)}</DeskText>
            {catalog.models.filter(model => model.provider === provider).map(model => {
                const key = shogModelKey(model);
                const checked = preferences.enabled.includes(key);
                return <Pressable key={key} testID={`ip-shog-model-${key}`} accessibilityRole="checkbox"
                    accessibilityLabel={model.label} accessibilityState={{ checked }} onPress={() => preferences.toggle(key)}
                    style={{ minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                    <DeskText style={{ color: theme.colors.text.primary }}>{checked ? '✓' : '○'}</DeskText>
                    <DeskText style={{ color: theme.colors.text.primary }}>{model.label}</DeskText>
                </Pressable>;
            })}
        </View>)}
        {catalog.models.length === 0 ? <DeskText accessibilityLiveRegion="polite" style={{ color: theme.colors.text.secondary }}>{t('ignorePrevious.shogModels.modelsUnavailable')}</DeskText> : null}
    </View>;
}
