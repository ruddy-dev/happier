import * as React from 'react';
import { Platform, Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useUnistyles } from 'react-native-unistyles';

import { useSetting } from '@/sync/domains/state/storage';
import { t } from '@/text';
import { useDeskPref } from '../deskPrefs';
import { DeskText } from '../typography/DeskText';

export function DeskVoiceSettings() {
    const router = useRouter();
    const { theme } = useUnistyles();
    const voice = useSetting('voice');
    const language = voice.assistantLanguage?.trim() || t('ignorePrevious.voice.browserDefault');
    const [holdSpace, setHoldSpace] = useDeskPref('deskHoldSpace');

    return <View style={{ gap: 12 }}>
        <DeskText accessibilityRole="header" style={{ color: theme.colors.text.secondary }}>{t('ignorePrevious.voice.title')}</DeskText>
        <DeskText style={{ color: theme.colors.text.secondary }}>{t('ignorePrevious.voice.unsent')}</DeskText>
        <View style={{ gap: 4 }}>
            <DeskText style={{ color: theme.colors.text.primary }}>{t('ignorePrevious.voice.engine')}</DeskText>
            <DeskText style={{ color: theme.colors.text.secondary, fontSize: 12 }}>{t('ignorePrevious.voice.googleWarning')}</DeskText>
        </View>
        <DeskText style={{ color: theme.colors.text.secondary, fontSize: 12 }}>{t('ignorePrevious.voice.speechServerPlanned')}</DeskText>
        <DeskText testID="ip-voice-language" style={{ color: theme.colors.text.primary }}>{t('ignorePrevious.voice.language', { language })}</DeskText>
        <Pressable
            testID="ip-voice-settings-link" accessibilityRole="link"
            onPress={() => router.navigate('/settings/voice')}
            style={{ minHeight: 48, justifyContent: 'center', paddingHorizontal: 12, alignSelf: 'flex-start', borderWidth: 1, borderColor: theme.colors.border.default }}
        >
            <DeskText style={{ color: theme.colors.text.primary }}>{t('ignorePrevious.voice.changeSettings')}</DeskText>
        </Pressable>
        <Pressable
            testID="ip-voice-hold-space" accessibilityRole="switch"
            accessibilityLabel={t('ignorePrevious.voice.holdSpace')}
            accessibilityHint={t(Platform.OS === 'web' ? 'ignorePrevious.voice.holdSpaceDetail' : 'ignorePrevious.voice.native')}
            accessibilityState={{ checked: holdSpace }}
            onPress={() => setHoldSpace(!holdSpace)}
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16, minHeight: 48 }}
        >
            <DeskText style={{ color: theme.colors.text.primary, flexShrink: 1 }}>{t('ignorePrevious.voice.holdSpace')}</DeskText>
            <DeskText style={{ color: theme.colors.text.secondary }}>{t(holdSpace ? 'ignorePrevious.settings.on' : 'ignorePrevious.settings.off')}</DeskText>
        </Pressable>
        <DeskText style={{ color: theme.colors.text.secondary, fontSize: 12 }}>{t('ignorePrevious.voice.holdSpaceDetail')}</DeskText>
        {Platform.OS !== 'web' ? <DeskText style={{ color: theme.colors.text.secondary, fontSize: 12 }}>{t('ignorePrevious.voice.native')}</DeskText> : null}
    </View>;
}
