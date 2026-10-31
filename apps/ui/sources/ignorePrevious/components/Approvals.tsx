import * as React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';

import { Icon } from '@/components/ui/icons/Icon';
import { Text } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';

import { useWaitingCount, WaitingPanel } from './WaitingPanel';

/** Opens and closes the approvals drawer, with how many things wait on you. */
export function ApprovalsButton({ open, onPress }: { open: boolean; onPress: () => void }) {
    const { theme } = useUnistyles();
    const count = useWaitingCount();
    const waiting = count > 0;
    return (
        <Pressable
            testID="ip-approvals-open"
            accessibilityRole="button"
            accessibilityState={{ expanded: open }}
            accessibilityLabel={open ? t('ignorePrevious.closeApprovals') : t('ignorePrevious.openApprovals', { count })}
            onPress={onPress}
            hitSlop={6}
            style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                paddingHorizontal: 10,
                paddingVertical: 5,
                borderRadius: 999,
                borderWidth: 1,
                borderColor: waiting ? theme.colors.state.warning.border : theme.colors.border.default,
                backgroundColor: waiting ? theme.colors.state.warning.background : 'transparent',
            }}
        >
            <Text style={{ color: theme.colors.text.primary, fontSize: 13 }}>{t('ignorePrevious.title')}</Text>
            <Text testID="ip-approvals-count" style={{ color: theme.colors.text.primary, fontSize: 13, ...Typography.default('semiBold') }}>
                {count}
            </Text>
        </Pressable>
    );
}

/** The drawer beside the coordinator: everything that waits on you, with Allow and Deny. */
export function ApprovalsDrawer({ onClose }: { onClose: () => void }) {
    const { theme } = useUnistyles();
    return (
        <View testID="ip-approvals-drawer" style={{ flex: 1, backgroundColor: theme.colors.surface.base }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 8 }}>
                <Text
                    accessibilityRole="header"
                    style={{ color: theme.colors.text.primary, fontSize: 18, ...Typography.default('semiBold') }}
                >
                    {t('ignorePrevious.title')}
                </Text>
                <Pressable
                    testID="ip-approvals-close"
                    accessibilityRole="button"
                    accessibilityLabel={t('ignorePrevious.closeApprovals')}
                    onPress={onClose}
                    hitSlop={8}
                    style={{ marginLeft: 'auto', padding: 6, borderRadius: 8 }}
                >
                    <Icon name="x" size={18} color={theme.colors.text.secondary} />
                </Pressable>
            </View>
            <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 16 }}>
                <WaitingPanel />
            </ScrollView>
        </View>
    );
}
