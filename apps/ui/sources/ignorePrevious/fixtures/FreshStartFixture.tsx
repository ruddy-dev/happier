import * as React from 'react';
import { Pressable, View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { t } from '@/text';
import { FreshStartMenu } from '../components/FreshStartMenu';
import { DeskText } from '../typography/DeskText';

/** Dev-only handler log. No prompt, compact or new-session operation is wired here. */
export function FreshStartFixture() {
    const { theme } = useUnistyles();
    const [replying, setReplying] = React.useState(false);
    const [actions, setActions] = React.useState<string[]>([]);
    const log = (action: string) => setActions(previous => [...previous, action]);
    return <View testID="ip-fresh-fixture" style={{ padding: 12, gap: 8 }}>
        <DeskText style={{ color: theme.colors.text.primary }}>{t('ignorePrevious.freshStart.fixtureTitle')}</DeskText>
        <Pressable accessibilityRole="button" testID="ip-fresh-fixture-reply" onPress={() => setReplying(true)} style={{ minHeight: 44, justifyContent: 'center' }}>
            <DeskText style={{ color: theme.colors.text.secondary }}>{t('ignorePrevious.freshStart.fixtureReplying')}</DeskText>
        </Pressable>
        <FreshStartMenu
            onBriefMe={() => log(t('ignorePrevious.freshStart.brief'))}
            onCompact={() => log(t('ignorePrevious.freshStart.compact'))}
            onNewConversation={() => log(t('ignorePrevious.freshStart.newConversation'))}
            stop={replying ? <Pressable testID="ip-fresh-fixture-stop" accessibilityRole="button"
                onPress={() => { log(t('runs.stop.stopRunA11y')); setReplying(false); }}
                style={{ minHeight: 44, paddingHorizontal: 12, justifyContent: 'center' }}>
                <DeskText style={{ color: theme.colors.text.primary }}>{t('runs.stop.stopRunA11y')}</DeskText>
            </Pressable> : null}
        />
        <View accessibilityLiveRegion="polite">
            {actions.map((action, index) => <DeskText key={index} style={{ color: theme.colors.text.secondary }}>
                {t('ignorePrevious.freshStart.fixtureLog', { action })}
            </DeskText>)}
        </View>
    </View>;
}
