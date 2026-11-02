import * as React from 'react';
import { Platform, Pressable, View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { Popover } from '@/components/ui/popover/Popover';
import { FloatingOverlay } from '@/components/ui/overlays/FloatingOverlay';
import { t } from '@/text';
import { deskUsageRows } from '../model/deskUsage';
import { useDeskPopup } from '../popups/useDeskPopup';
import { DeskText } from '../typography/DeskText';

export function DeskUsageButton() {
    const { theme } = useUnistyles();
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
            accessibilityLabel={t('ignorePrevious.topBar.usage')} accessibilityState={{ expanded: open }}
            aria-haspopup="dialog" aria-expanded={open} onPress={() => open ? close() : setOpen(true)}
            style={{ marginLeft: 'auto', padding: 8, minHeight: 44, justifyContent: 'center' }}>
            <DeskText style={{ color: theme.colors.text.secondary }}>{t('ignorePrevious.topBar.usage')}</DeskText>
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
                    {deskUsageRows().map(row => <View key={row.id} testID={`ip-usage-row-${row.id}`} style={{ gap: 4 }}>
                        <DeskText style={{ color: theme.colors.text.primary }}>{t(`ignorePrevious.usage.${row.id}`)}{row.estimate ? t('ignorePrevious.usage.estimate') : null}</DeskText>
                        <DeskText style={{ color: theme.colors.text.secondary }}>{t('ignorePrevious.usage.notAvailable')}</DeskText>
                    </View>)}
                    <DeskText testID="ip-usage-reason" style={{ color: theme.colors.text.secondary }}>{t('ignorePrevious.usage.reason')}</DeskText>
                </View>
            </FloatingOverlay>}
        </Popover>
    </>;
}
