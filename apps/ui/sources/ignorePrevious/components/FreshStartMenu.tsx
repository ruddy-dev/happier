import * as React from 'react';
import { Platform, Pressable, View, useWindowDimensions } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { isMobileLayoutWidth } from '@/components/sessions/layout/isMobileLayoutWidth';
import { Popover } from '@/components/ui/popover/Popover';
import { FloatingOverlay } from '@/components/ui/overlays/FloatingOverlay';
import { t } from '@/text';
import { ESCAPE_LAYER_PRIORITIES, getMaxEscapeKeyBlockerPriority, useEscapeLayer } from '@/keyboard/escape';
import { useDeskPopup } from '../popups/useDeskPopup';
import { DeskText } from '../typography/DeskText';

export type FreshStartMenuProps = Readonly<{
    onBriefMe: () => void;
    onCompact: () => void;
    onNewConversation: () => void;
    /** The header owns Stop; it never folds into the menu. */
    stop?: React.ReactNode;
}>;

/** Item 2.9 supplies real handlers and mounts this in the coordinator header. */
export function FreshStartMenu({ onBriefMe, onCompact, onNewConversation, stop }: FreshStartMenuProps) {
    const { theme } = useUnistyles();
    const { width } = useWindowDimensions();
    const mobile = isMobileLayoutWidth(width);
    const [open, setOpen] = React.useState(false);
    const [confirming, setConfirming] = React.useState(false);
    const openerRef = React.useRef<View>(null);
    const contentRef = React.useRef<View>(null);
    const newRef = React.useRef<View>(null);
    const returnToNew = React.useRef(false);
    const focusCancel = React.useCallback((node: View | null) => { node?.focus(); }, []);
    const close = () => { setOpen(false); setConfirming(false); };
    useDeskPopup({ open, onClose: close, openerRef, contentRef, returnFocusOnClose: true });
    useEscapeLayer({
        enabled: Platform.OS === 'web' && open && confirming,
        priority: ESCAPE_LAYER_PRIORITIES.popover + 1,
        allowEditableTarget: true,
        onEscape: () => {
            if (getMaxEscapeKeyBlockerPriority() > ESCAPE_LAYER_PRIORITIES.popover + 1) return false;
            returnToNew.current = true;
            setConfirming(false);
        },
    });
    React.useEffect(() => {
        if (!confirming && returnToNew.current) {
            newRef.current?.focus();
            returnToNew.current = false;
        }
    }, [confirming]);
    const pick = (handler: () => void) => { close(); handler(); };
    const textStyle = { color: theme.colors.text.primary };
    const buttonStyle = { minHeight: 44, justifyContent: 'center' as const, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 };
    const label = t(mobile ? 'ignorePrevious.freshStart.moreLabel' : 'ignorePrevious.freshStart.title');
    return <>
        <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
            {stop}
            {!mobile ? <Pressable testID="ip-fresh-brief" accessibilityRole="button" onPress={onBriefMe} style={buttonStyle}>
                <DeskText style={textStyle}>{t('ignorePrevious.freshStart.brief')}</DeskText>
            </Pressable> : null}
            <Pressable ref={openerRef} testID={mobile ? 'ip-fresh-more' : 'ip-fresh-start'} accessibilityRole="button"
                accessibilityLabel={label} aria-haspopup="menu" aria-expanded={open} accessibilityState={{ expanded: open }}
                onPress={() => open ? close() : setOpen(true)} style={buttonStyle}>
                <DeskText style={textStyle}>{t(mobile ? 'ignorePrevious.freshStart.more' : 'ignorePrevious.freshStart.title')}</DeskText>
            </Pressable>
        </View>
        <Popover open={open} anchorRef={openerRef} placement="bottom" portal={{ web: true }}
            {...(Platform.OS === 'web' ? { backdrop: false as const } : { backdrop: true as const, onRequestClose: close })}
            maxWidthCap={320} edgePadding={8}>
            {({ maxHeight }) => <FloatingOverlay maxHeight={maxHeight} containerStyle={{ width: 320, maxWidth: '100%' }}>
                <View ref={contentRef} testID="ip-fresh-menu" style={{ padding: 6 }}
                    accessibilityRole={confirming ? undefined : 'menu'} accessibilityLabel={label}>
                    {confirming ? <View testID="ip-fresh-confirm" role="group" accessibilityLabel={t('ignorePrevious.freshStart.question')}>
                        <DeskText style={[textStyle, { padding: 10, fontWeight: '600' }]}>{t('ignorePrevious.freshStart.question')}</DeskText>
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                            <Pressable testID="ip-fresh-cancel" accessibilityRole="button" style={buttonStyle}
                                ref={focusCancel}
                                onPress={() => { returnToNew.current = true; setConfirming(false); }}>
                                <DeskText style={textStyle}>{t('ignorePrevious.freshStart.cancel')}</DeskText>
                            </Pressable>
                            <Pressable testID="ip-fresh-confirm-new" accessibilityRole="button" style={[buttonStyle, { backgroundColor: theme.colors.surface.selected }]}
                                onPress={() => pick(onNewConversation)}>
                                <DeskText style={textStyle}>{t('ignorePrevious.freshStart.newConversation')}</DeskText>
                            </Pressable>
                        </View>
                    </View> : <>
                        {mobile ? <Pressable testID="ip-fresh-brief" accessibilityRole="menuitem" onPress={() => pick(onBriefMe)} style={buttonStyle}>
                            <DeskText style={textStyle}>{t('ignorePrevious.freshStart.brief')}</DeskText>
                        </Pressable> : null}
                        <Pressable testID="ip-fresh-compact" accessibilityRole="menuitem" onPress={() => pick(onCompact)} style={buttonStyle}>
                            <DeskText style={textStyle}>{t('ignorePrevious.freshStart.compact')}</DeskText>
                            <DeskText style={{ color: theme.colors.text.secondary, fontSize: 12 }}>{t('ignorePrevious.freshStart.keepsSummary')}</DeskText>
                        </Pressable>
                        <Pressable ref={newRef} testID="ip-fresh-new" accessibilityRole="menuitem" onPress={() => setConfirming(true)} style={buttonStyle}>
                            <DeskText style={textStyle}>{t('ignorePrevious.freshStart.newConversation')}</DeskText>
                        </Pressable>
                    </>}
                </View>
            </FloatingOverlay>}
        </Popover>
    </>;
}
