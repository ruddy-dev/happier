import * as React from 'react';
import { Pressable, View } from 'react-native';
import { t } from '@/text';
import { Icon } from '@/components/ui/icons/Icon';
import { DeskText } from '../typography/DeskText';
import { MaskFace } from './MaskFace';
import { DeskUsageButton } from './DeskUsageButton';
import { useTopBarAppearance } from './topBarAppearance';

export function DeskTopBar({ phone, sessionsRef, onSessions, waiting, settings }: { phone: boolean; sessionsRef: React.RefObject<View | null>; onSessions: () => void; waiting: React.ReactNode; settings: (colour: string) => React.ReactNode }) {
    const { terminal, paint, maskColours } = useTopBarAppearance();
    return <View testID="ip-top-bar" style={{ minHeight: 52, minWidth: 0, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: paint.rule, backgroundColor: paint.bg }}>
        <View testID="ip-top-brand" style={{ flexDirection: 'row', alignItems: 'center', gap: 9, flexShrink: 1, minWidth: 0 }}>
            {terminal && <DeskText accessible={false} aria-hidden style={{ color: paint.user, fontSize: 15, fontWeight: '700' }}>$</DeskText>}
            <View testID="ip-top-brand-mask" aria-hidden accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ flexShrink: 0 }}>
                <MaskFace size={26} bulb="rest" colours={maskColours} />
            </View>
            <DeskText numberOfLines={1} style={{ color: paint.ink, fontSize: terminal ? 15 : 18, fontWeight: '700', flexShrink: 1 }}>{t('ignorePrevious.topBar.brand')}</DeskText>
        </View>
        <Pressable ref={sessionsRef} testID="ip-top-sessions" accessibilityRole="button" accessibilityLabel={t('ignorePrevious.topBar.sessions')} onPress={onSessions}
            style={{ minHeight: 44, minWidth: 44, paddingHorizontal: phone ? 8 : 12, flexShrink: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 1, borderColor: paint.rule, borderRadius: terminal ? 2 : 999 }}>
            <Icon name="list" size={16} color={paint.ink} />
            {!phone && <DeskText style={{ color: paint.ink, fontSize: terminal ? 12.5 : 13.5 }}>{t('ignorePrevious.topBar.sessions')}</DeskText>}
        </Pressable>
        <DeskUsageButton phone={phone} />
        {!phone && <View testID="ip-top-waiting" style={{ flexShrink: 0 }}>{waiting}</View>}
        <View testID="ip-top-settings" style={{ flexShrink: 0 }}>{settings(paint.mute)}</View>
    </View>;
}
