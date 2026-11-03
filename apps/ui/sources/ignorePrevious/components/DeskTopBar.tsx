import * as React from 'react';
import { Pressable, View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { t } from '@/text';
import { Icon } from '@/components/ui/icons/Icon';
import { DeskText } from '../typography/DeskText';
import { MaskFace } from './MaskFace';
import { DeskUsageButton } from './DeskUsageButton';

export function DeskTopBar({ phone, sessionsRef, onSessions, waiting, settings }: { phone: boolean; sessionsRef: React.RefObject<View | null>; onSessions: () => void; waiting: React.ReactNode; settings: React.ReactNode }) {
    const { theme } = useUnistyles();
    return <View testID="ip-top-bar" style={{ minHeight: 52, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: theme.colors.border.default }}>
        {phone && <View testID="ip-top-brand" style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1, minWidth: 0 }}>
            <MaskFace size={24} bulb="rest" />
            <DeskText numberOfLines={1} style={{ color: theme.colors.text.primary, fontSize: 16, fontWeight: '700', flexShrink: 1 }}>{t('ignorePrevious.screenTitle')}</DeskText>
        </View>}
        <Pressable ref={sessionsRef} testID="ip-top-sessions" accessibilityRole="button" accessibilityLabel={t('ignorePrevious.topBar.sessions')} onPress={onSessions} style={{ padding: 8 }}>{phone ? <Icon name="list" size={20} color={theme.colors.text.primary} /> : <DeskText style={{ color: theme.colors.text.primary }}>{t('ignorePrevious.topBar.sessions')}</DeskText>}</Pressable>
        <DeskUsageButton />
        {!phone && <View testID="ip-top-waiting">{waiting}</View>}
        <View testID="ip-top-settings">{settings}</View>
    </View>;
}
