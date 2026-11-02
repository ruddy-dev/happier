import * as React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useUnistyles } from 'react-native-unistyles';

import { useLayoutMaxWidth } from '@/components/ui/layout/layout';
import { t } from '@/text';

import { useDeskPref } from '../deskPrefs';
import { DeskFontRoot } from '../fonts/DeskFontRoot';
import { DeskText } from '../typography/DeskText';

export function DeskSettingsScreen() {
    const router = useRouter();
    const { theme } = useUnistyles();
    const maxWidth = useLayoutMaxWidth();
    const [creatureEnabled, setCreatureEnabled] = useDeskPref('creatureEnabled');

    return (
        <DeskFontRoot>
            <ScrollView style={{ flex: 1, backgroundColor: theme.colors.surface.base }}>
                <View style={{ width: '100%', maxWidth, alignSelf: 'center', padding: 20, gap: 24 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
                        <Pressable
                            testID="ip-settings-back"
                            accessibilityRole="button"
                            onPress={() => router.navigate('/desk')}
                            style={{ minHeight: 48, justifyContent: 'center', paddingHorizontal: 8 }}
                        >
                            <DeskText style={{ color: theme.colors.text.secondary }}>{t('ignorePrevious.settings.backToDesk')}</DeskText>
                        </Pressable>
                        <DeskText accessibilityRole="header" style={{ color: theme.colors.text.primary }}>
                            {t('ignorePrevious.settings.title')}
                        </DeskText>
                    </View>
                    <View testID="ip-settings-sections" />
                    <Pressable
                        testID="ip-settings-creature"
                        accessibilityRole="switch"
                        accessibilityLabel={t('ignorePrevious.settings.creature')}
                        accessibilityState={{ checked: creatureEnabled }}
                        onPress={() => setCreatureEnabled(!creatureEnabled)}
                        style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16, minHeight: 48 }}
                    >
                        <DeskText style={{ color: theme.colors.text.primary }}>{t('ignorePrevious.settings.creature')}</DeskText>
                        <DeskText style={{ color: theme.colors.text.secondary }}>
                            {creatureEnabled ? t('ignorePrevious.settings.on') : t('ignorePrevious.settings.off')}
                        </DeskText>
                    </Pressable>
                    <View style={{ borderTopWidth: 1, borderTopColor: theme.colors.border.default, paddingTop: 20, gap: 8 }}>
                        <DeskText accessibilityRole="header" style={{ color: theme.colors.text.secondary }}>
                            {t('ignorePrevious.settings.about')}
                        </DeskText>
                        <DeskText style={{ color: theme.colors.text.primary }}>{t('ignorePrevious.settings.credit')}</DeskText>
                        <DeskText style={{ color: theme.colors.text.secondary }}>{t('ignorePrevious.settings.forkNotice')}</DeskText>
                    </View>
                </View>
            </ScrollView>
        </DeskFontRoot>
    );
}
