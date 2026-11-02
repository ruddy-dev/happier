import * as React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';

import { Icon } from '@/components/ui/icons/Icon';
import { Text } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';
import { type CustomModalInjectedProps } from '@/modal';
import { useModalCardChrome } from '@/modal/components/card/useModalCardChrome';
import { t } from '@/text';

import { useDeskWaitsSummary } from '../model/useDeskWaits';
import { WaitingPanel, type WaitingHistory } from './WaitingPanel';

/** Opens and closes the approvals drawer, with how many things wait on you. */
export function ApprovalsButton({ open, onPress }: { open: boolean; onPress: () => void }) {
    const { theme } = useUnistyles();
    const { count, ready } = useDeskWaitsSummary();
    const waiting = ready && count > 0;
    // Before the first sync the count is not known yet; 0 would say nothing waits (F4).
    const label = open
        ? (ready ? t('ignorePrevious.closeApprovals', { count }) : t('ignorePrevious.closeApprovalsConnecting'))
        : (ready ? t('ignorePrevious.openApprovals', { count }) : t('ignorePrevious.openApprovalsConnecting'));
    return (
        <Pressable
            testID="ip-approvals-open"
            accessibilityRole="button"
            accessibilityState={{ expanded: open }}
            accessibilityLabel={label}
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
                {ready ? count : '–'}
            </Text>
        </Pressable>
    );
}

/**
 * The same list as a card, for layouts with no room for a drawer: a phone, or multi-pane panels
 * switched off. The card chrome carries the title and the close button.
 */
export function ApprovalsCard({ onClose, setChrome, history }: CustomModalInjectedProps & { history?: WaitingHistory }) {
    const chrome = React.useMemo(() => ({
        kind: 'card' as const,
        title: t('ignorePrevious.title'),
        testID: 'ip-approvals-card',
        closeButtonTestID: 'ip-approvals-card-close',
        dimensions: { width: 480, maxHeightRatio: 0.85, size: 'dialog' as const },
    }), []);
    useModalCardChrome(setChrome, chrome);
    return (
        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 16 }}>
            <WaitingPanel onOpenSession={onClose} history={history} />
        </ScrollView>
    );
}

/** The drawer beside the coordinator: everything that waits on you, with Allow and Deny. */
export function ApprovalsDrawer({ onClose, history }: { onClose: () => void; history?: WaitingHistory }) {
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
                    accessibilityLabel={t('common.close')}
                    onPress={onClose}
                    hitSlop={8}
                    style={{ marginLeft: 'auto', padding: 6, borderRadius: 8 }}
                >
                    <Icon name="x" size={18} color={theme.colors.text.secondary} />
                </Pressable>
            </View>
            <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 16 }}>
                <WaitingPanel history={history} />
            </ScrollView>
        </View>
    );
}
