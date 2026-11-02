import * as React from 'react';
import { Pressable, View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { DeskText as Text } from '../typography/DeskText';
import { t } from '@/text';
import { DeskCreature } from '../creature/DeskCreature';
import type { CreatureCoordinator } from '../creature/creatureMode';
import { useCreatureMode } from '../creature/useCreatureMode';

/** Imported only by the flag-gated fixture coordinator body. No product store writes. */
export function CreatureFixture() {
    const { theme } = useUnistyles();
    const [coordinator, setCoordinator] = React.useState<CreatureCoordinator>('idle');
    const [style, setStyle] = React.useState<'slips' | 'terminal'>('slips');
    const [calm, setCalm] = React.useState(false);
    const [second, setSecond] = React.useState(false);
    const [requests, setRequests] = React.useState<{ sessionId: string; requestId: string }[]>([]);
    const sequence = React.useRef(0);
    const mode = useCreatureMode({ coordinator, calm, waitingCount: requests.length, requests, unloadedSessionIds: [] });
    function button(label: string, onPress: () => void, selected = false) {
        return <Pressable key={label} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected }} onPress={onPress}
            style={{ minHeight: 48, paddingHorizontal: 12, justifyContent: 'center', borderWidth: 1,
                borderColor: theme.colors.border.default, borderRadius: 8,
                backgroundColor: selected ? theme.colors.surface.elevated : theme.colors.surface.inset }}>
            <Text style={{ color: theme.colors.text.primary }}>{label}</Text>
        </Pressable>;
    }
    return <View testID="ip-creature-fixture" style={{ padding: 12, gap: 8 }}>
        <Text style={{ color: theme.colors.text.primary }}>{t('ignorePrevious.creature.fixtureTitle')}</Text>
        <DeskCreature style={style} redEyes={requests.length} mode={mode} />
        {second && <DeskCreature style={style} redEyes={requests.length} mode={mode} />}
        <Text style={{ color: theme.colors.text.secondary }}>
            {t('ignorePrevious.creature.fixtureStatus', { mode: t(`ignorePrevious.creature.${mode}`), count: requests.length })}
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {(['idle', 'replying', 'offline', 'resuming', 'none'] as const).map(value =>
                button(t(`ignorePrevious.creature.${value}`), () => setCoordinator(value), coordinator === value))}
            {button(t('ignorePrevious.creature.newRequest'), () => {
                sequence.current += 1;
                const requestId = `request-${sequence.current}`;
                setRequests(previous => [...previous, { sessionId: 'fixture-worker', requestId }]);
            })}
            {button(t('ignorePrevious.creature.phoneAnswer'), () => setRequests(previous => previous.slice(1)))}
            {button(t('ignorePrevious.creature.calmControl'), () => setCalm(value => !value), calm)}
            {button(t('ignorePrevious.creature.terminalControl'), () => setStyle(value => value === 'slips' ? 'terminal' : 'slips'), style === 'terminal')}
            {button(t('ignorePrevious.creature.secondControl'), () => setSecond(value => !value), second)}
        </View>
    </View>;
}
