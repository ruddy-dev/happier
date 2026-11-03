import * as React from 'react';
import { Platform, Pressable, ScrollView, View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { Popover } from '@/components/ui/popover/Popover';
import { FloatingOverlay } from '@/components/ui/overlays/FloatingOverlay';
import { shadowLevelStyle } from '@/shadowElevation';
import { t } from '@/text';
import { deskUsageRows, type DeskUsageInput } from '../model/deskUsage';
import { useDeskPopup } from '../popups/useDeskPopup';
import { DeskText } from '../typography/DeskText';
import { terminalPalettes } from '../palette';
import { useTopBarAppearance } from './topBarAppearance';

function UsagePopoverSurface({ terminal, paint, maxHeight, children }: React.PropsWithChildren<{
    terminal: boolean;
    paint: ReturnType<typeof useTopBarAppearance>['paint'];
    maxHeight: number;
}>) {
    const { theme } = useUnistyles();
    if (!terminal) return <FloatingOverlay maxHeight={maxHeight} surfaceChrome="theme" containerStyle={{ width: 330, maxWidth: '100%' }}>{children}</FloatingOverlay>;
    // FloatingOverlay has no inner-surface override. Keep this art-directed chrome
    // local; Popover still owns placement/bounds and useDeskPopup owns dismissal.
    return <View style={{ ...shadowLevelStyle(theme.colors.shadowLevels[2]), width: 330, maxWidth: '100%', maxHeight,
        backgroundColor: paint.panel, borderColor: paint.edge, borderWidth: paint === terminalPalettes.terminalPaper ? 2 : 1, borderRadius: 2 }}>
        {Platform.OS === 'web' && React.createElement('style', null,
            `[data-testid="ip-usage-popover"] [data-testid="ip-usage-close"]:focus-visible { outline: 3px solid ${paint.ink}; outline-offset: 2px; border-radius: 6px; }`)}
        <ScrollView style={{ maxHeight, flexShrink: 1 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {children}
        </ScrollView>
    </View>;
}

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
            style={{ marginLeft: 'auto', paddingVertical: 8, paddingHorizontal: phone ? 4 : 8, minHeight: 44, minWidth: phone ? 44 : undefined, flexShrink: 0, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: open ? paint.rule : 'transparent', borderRadius: terminal ? 2 : 999 }}>
            {!(phone && available) && <DeskText style={{ color: paint.mute, fontSize: terminal ? 12 : 12.5 }}>{t('ignorePrevious.topBar.usage')}</DeskText>}
            {(!phone || available) && <DeskText testID="ip-top-usage-inline" style={{ color: phone ? paint.ink : paint.mute, fontSize: terminal ? 12 : 12.5,
                ...(phone ? { textAlign: 'center', fontVariant: ['tabular-nums'] as const } : {}) }}>
                {phone && available ? t(`ignorePrevious.usage.phoneSummary.${available.id}`, { value: available.text }) : status}
            </DeskText>}
        </Pressable>
        <Popover open={open} anchorRef={openerRef} placement="bottom"
            portal={{ web: true, matchAnchorWidth: false, anchorAlign: 'end' }}
            {...(Platform.OS === 'web' ? { backdrop: false as const } : { backdrop: true as const, onRequestClose: close })}
            maxWidthCap={330} edgePadding={8}>
            {({ maxHeight }) => <UsagePopoverSurface terminal={terminal} paint={paint} maxHeight={maxHeight}>
                <View ref={contentRef} testID="ip-usage-popover" role="dialog" accessibilityLabel={t('ignorePrevious.topBar.usage')}
                    style={{ paddingHorizontal: 14, paddingTop: terminal ? 10 : 12, paddingBottom: 12, gap: terminal ? 11 : 12 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <DeskText accessibilityRole="header" style={{ color: terminal ? paint.ink : theme.colors.text.primary, fontWeight: terminal ? '700' : '600', flex: 1, ...(terminal ? { fontSize: 13 } : {}) }}>
                            {terminal && <DeskText accessible={false} aria-hidden style={{ color: paint.bot }}># </DeskText>}
                            {t('ignorePrevious.topBar.usage')}
                        </DeskText>
                        <Pressable ref={focusClose} testID="ip-usage-close" accessibilityRole="button" onPress={close}
                            style={{ minWidth: 44, minHeight: 44, padding: 8, justifyContent: 'center', alignItems: 'center' }}>
                            <DeskText style={{ color: terminal ? paint.ink : theme.colors.text.primary, ...(terminal ? { fontSize: 12.5 } : {}) }}>{t('ignorePrevious.usage.close')}</DeskText>
                        </Pressable>
                    </View>
                    {rows.map(row => <View key={row.id} testID={`ip-usage-row-${row.id}`} style={{ gap: 4 }}>
                        <DeskText style={{ color: terminal ? paint.ink : theme.colors.text.primary, ...(terminal ? { fontSize: 13.5, fontWeight: '700' } : {}) }}>{row.label}</DeskText>
                        <DeskText style={{ color: terminal ? paint.ink : theme.colors.text.secondary, ...(terminal ? { fontSize: 13.5 } : {}) }}>{row.text}</DeskText>
                    </View>)}
                    {reason && <DeskText testID="ip-usage-reason" style={{ color: terminal ? paint.mute : theme.colors.text.secondary,
                        ...(terminal ? { fontSize: 12.5, lineHeight: 17, paddingTop: 8, borderTopWidth: 1, borderTopColor: paint.rule } : {}) }}>{reason}</DeskText>}
                </View>
            </UsagePopoverSurface>}
        </Popover>
    </>;
}
