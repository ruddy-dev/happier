import * as React from 'react';
import { Platform, Pressable, View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { Popover } from '@/components/ui/popover/Popover';
import { FloatingOverlay } from '@/components/ui/overlays/FloatingOverlay';
import { t } from '@/text';
import { deskUsageRows, type DeskUsageInput } from '../model/deskUsage';
import { useDeskPopup } from '../popups/useDeskPopup';
import { DeskText } from '../typography/DeskText';
import { useTopBarAppearance } from './topBarAppearance';

export function DeskUsageButton({ phone = false, usage }: { phone?: boolean; usage?: DeskUsageInput }) {
    const { theme } = useUnistyles();
    const { terminal, paint } = useTopBarAppearance();
    const rows = deskUsageRows(usage).map(row => ({
        ...row,
        label: t(`ignorePrevious.usage.${row.id}`) + (row.estimate ? t('ignorePrevious.usage.estimate') : ''),
        text: row.value === null ? t('ignorePrevious.usage.notAvailable') : t('ignorePrevious.usage.percentage', { value: row.value }),
    }));
    const available = rows.find(row => row.value !== null);
    const status = available
        ? t('ignorePrevious.usage.summary', { label: available.label, value: available.text })
        : t('ignorePrevious.usage.notAvailable');
    const reason = !available ? t('ignorePrevious.usage.reason')
        : rows.some(row => row.value === null) ? t('ignorePrevious.usage.partialReason') : null;
    const [open, setOpen] = React.useState(false);
    const openerRef = React.useRef<View>(null);
    const contentRef = React.useRef<View>(null);
    const focusClose = React.useCallback((node: View | null) => node?.focus(), []);
    const close = () => {
        setOpen(false);
    };
    useDeskPopup({ open, onClose: close, openerRef, contentRef });
    return <>
        <Pressable ref={openerRef} testID="ip-top-usage" accessibilityRole="button"
            accessibilityLabel={t('ignorePrevious.topBar.usageStatus', { status })} accessibilityState={{ expanded: open }}
            aria-haspopup="dialog" aria-expanded={open} onPress={() => open ? close() : setOpen(true)}
            style={{ marginLeft: 'auto', padding: 8, minHeight: 44, flexShrink: 0, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: open ? paint.rule : 'transparent', borderRadius: terminal ? 2 : 999 }}>
            <DeskText style={{ color: paint.mute, fontSize: terminal ? 12 : 12.5 }}>{t('ignorePrevious.topBar.usage')}</DeskText>
            {!phone && <DeskText testID="ip-top-usage-inline" style={{ color: paint.mute, fontSize: terminal ? 12 : 12.5 }}>{status}</DeskText>}
        </Pressable>
        <Popover open={open} anchorRef={openerRef} placement="bottom"
            portal={{ web: true, matchAnchorWidth: false, anchorAlign: 'end' }}
            {...(Platform.OS === 'web' ? { backdrop: false as const } : { backdrop: true as const, onRequestClose: close })}
            maxWidthCap={330} edgePadding={8}>
            {({ maxHeight }) => <FloatingOverlay maxHeight={maxHeight} surfaceChrome="theme" containerStyle={{ width: 330, maxWidth: '100%' }}>
                <View ref={contentRef} testID="ip-usage-popover" role="dialog" accessibilityLabel={t('ignorePrevious.topBar.usage')}
                    style={{ paddingHorizontal: 14, paddingVertical: 12, gap: 12 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <DeskText accessibilityRole="header" style={{ color: theme.colors.text.primary, fontWeight: '600', flex: 1 }}>{t('ignorePrevious.topBar.usage')}</DeskText>
                        <Pressable ref={focusClose} testID="ip-usage-close" accessibilityRole="button" onPress={close}
                            style={{ minWidth: 44, minHeight: 44, padding: 8, justifyContent: 'center', alignItems: 'center' }}>
                            <DeskText style={{ color: theme.colors.text.primary }}>{t('ignorePrevious.usage.close')}</DeskText>
                        </Pressable>
                    </View>
                    {rows.map(row => <View key={row.id} testID={`ip-usage-row-${row.id}`} style={{ gap: 4 }}>
                        <DeskText style={{ color: theme.colors.text.primary }}>{row.label}</DeskText>
                        <DeskText style={{ color: theme.colors.text.secondary }}>{row.text}</DeskText>
                    </View>)}
                    {reason && <DeskText testID="ip-usage-reason" style={{ color: theme.colors.text.secondary }}>{reason}</DeskText>}
                </View>
            </FloatingOverlay>}
        </Popover>
    </>;
}
