import * as React from 'react';
import { Pressable, View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { t } from '@/text';
import { DeskText } from '../typography/DeskText';

export function DeskTopBar({ phone, sessionsRef, onSessions, waiting, settings }: { phone: boolean; sessionsRef: React.RefObject<View | null>; onSessions: () => void; waiting: React.ReactNode; settings: React.ReactNode }) {
    const { theme } = useUnistyles();
    return <View testID="ip-top-bar" style={{ minHeight: 52, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: theme.colors.border.default }}>
        {!phone && <Pressable ref={sessionsRef} testID="ip-top-sessions" accessibilityRole="button" accessibilityLabel={t('ignorePrevious.topBar.sessions')} onPress={onSessions} style={{ padding: 8 }}><DeskText style={{ color: theme.colors.text.primary }}>{t('ignorePrevious.topBar.sessions')}</DeskText></Pressable>}
        <Pressable testID="ip-top-usage" accessibilityRole="button" accessibilityLabel={t('ignorePrevious.topBar.usage')} style={{ marginLeft: 'auto', padding: 8 }}><DeskText style={{ color: theme.colors.text.secondary }}>{t('ignorePrevious.topBar.usage')}</DeskText></Pressable>
        {!phone && <View testID="ip-top-waiting">{waiting}</View>}
        {!phone && <View testID="ip-top-settings">{settings}</View>}
    </View>;
}
