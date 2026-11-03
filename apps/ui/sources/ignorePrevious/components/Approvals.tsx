import * as React from 'react';
import { Animated, Easing, Platform, Pressable, ScrollView, View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';

import { Icon } from '@/components/ui/icons/Icon';
import { Typography } from '@/constants/Typography';
import { useReducedMotionPreference } from '@/hooks/ui/useReducedMotionPreference';
import { t } from '@/text';

import { drawerPlacement } from '../model/drawerPlacement';
import { useDeskPopup } from '../popups/useDeskPopup';
import { useDeskWaitsSummary } from '../model/useDeskWaits';
import { DeskText as Text } from '../typography/DeskText';
import { WaitingPanel, type WaitingHistory } from './WaitingPanel';
import { useTopBarAppearance } from './topBarAppearance';

/** Opens and closes the approvals drawer, with how many things wait on you. */
export function ApprovalsButton({ open, onPress, openerRef, phone = false }: { open: boolean; onPress: () => void; openerRef?: React.RefObject<View | null>; phone?: boolean }) {
    const { theme } = useUnistyles();
    const { terminal, paint } = useTopBarAppearance();
    const { count, ready } = useDeskWaitsSummary();
    const waiting = ready && count > 0;
    // Before the first sync the count is not known yet; 0 would say nothing waits (F4).
    const label = open
        ? (ready ? t('ignorePrevious.closeApprovals', { count }) : t('ignorePrevious.closeApprovalsConnecting'))
        : (ready ? t('ignorePrevious.openApprovals', { count }) : t('ignorePrevious.openApprovalsConnecting'));
    return (
        <Pressable
            ref={openerRef}
            testID={phone ? "ip-tab-waiting" : "ip-approvals-open"}
            accessibilityRole={phone ? "tab" : "button"}
            aria-selected={phone ? open : undefined}
            accessibilityState={phone ? { selected: open, expanded: open } : { expanded: open }}
            accessibilityLabel={label}
            accessibilityHint={phone ? t('ignorePrevious.topBar.waitingHint') : undefined}
            onPress={onPress}
            hitSlop={6}
            style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                paddingHorizontal: 10,
                paddingVertical: 5,
                minHeight: 44,
                flexShrink: 0,
                borderRadius: terminal ? 2 : 999,
                borderWidth: 1,
                borderColor: waiting ? paint.yel : paint.rule,
                backgroundColor: waiting ? paint.yel : 'transparent',
            }}
        >
            <Text style={{ color: waiting ? paint.yelink : paint.ink, fontSize: terminal || phone ? 12.5 : 13.5, fontWeight: waiting ? '700' : '500', letterSpacing: phone ? -0.25 : 0 }}>{t('ignorePrevious.title')}</Text>
            <Text testID="ip-approvals-count" style={{ color: waiting ? paint.yel : terminal ? paint.mute : theme.colors.text.secondary, backgroundColor: waiting ? paint.yelink : 'transparent', paddingHorizontal: waiting ? 6 : 0, borderRadius: terminal ? 2 : 999, fontSize: 12, fontVariant: ['tabular-nums'], ...Typography.default('semiBold') }}>
                {ready ? count : '–'}
            </Text>
            <Icon name={phone ? 'caret-up' : 'sidebar-right-open'} size={16} color={waiting ? paint.yelink : paint.mute} />
        </Pressable>
    );
}

/** The drawer beside the coordinator: everything that waits on you, with Allow and Deny. */
export function ApprovalsDrawer({ open, width, openerRef, focusOnOpen = false, hasHalfAnsweredCard = false, onDirtyChange, onClose, history, children }: {
    open: boolean;
    width: number;
    openerRef: React.RefObject<View | null>;
    /** True only for an explicit user open. Restoring or resizing never moves focus. */
    focusOnOpen?: boolean;
    /** Question-card owner supplies whether any option or unsent text is pending. */
    hasHalfAnsweredCard?: boolean;
    onDirtyChange?: (dirty: boolean) => void;
    onClose: () => void;
    history?: WaitingHistory;
    children?: React.ReactNode;
}) {
    const { theme } = useUnistyles();
    const placement = drawerPlacement(width);
    const contentRef = React.useRef<View>(null);
    const closeRef = React.useRef<View>(null);
    const reducedMotion = useReducedMotionPreference();
    const [entrance] = React.useState(() => new Animated.Value(1));
    useDeskPopup({ open, onClose, openerRef, contentRef, hasHalfAnsweredCard,
        presentation: placement === 'docked' ? 'docked' : 'overlay', useLiveOpenerWhenDetached: true });
    const wasOpen = React.useRef(false);
    React.useEffect(() => {
        const opening = open && !wasOpen.current;
        wasOpen.current = open;
        if (opening && focusOnOpen && placement !== 'docked' && Platform.OS === 'web'
            && typeof HTMLElement !== 'undefined' && closeRef.current instanceof HTMLElement) closeRef.current.focus();
    }, [open, focusOnOpen, placement]);
    React.useEffect(() => {
        if (!open) return;
        // One finite entrance, following mockup 12's din. Resizing never replays it.
        entrance.setValue(reducedMotion ? 1 : 0);
        const animation = Animated.timing(entrance, {
            toValue: 1, duration: reducedMotion ? 0 : 220, easing: Easing.out(Easing.ease), useNativeDriver: true,
        });
        animation.start();
        return () => animation.stop();
    }, [open, reducedMotion, entrance]);
    if (!open) return null;
    return (
        <Animated.View style={[
            { minWidth: 0, width: 390, maxWidth: '100%', flexShrink: 0 },
            placement === 'docked' ? { alignSelf: 'stretch' } : {
                position: 'absolute', top: 0, bottom: 0, right: 0, zIndex: 20,
                ...(placement === 'fullscreen' ? { left: 0, width: '100%' } : {}),
            },
            { opacity: entrance, transform: [{ translateX: entrance.interpolate({ inputRange: [0, 1], outputRange: [40, 0] }) }] },
        ]}>
            <View ref={contentRef} testID="ip-approvals-drawer" accessibilityLabel={t('ignorePrevious.title')}
                style={{ flex: 1, minHeight: 0, backgroundColor: theme.colors.surface.base,
                    borderLeftWidth: placement === 'fullscreen' ? 0 : 1, borderLeftColor: theme.colors.border.default }}>

                <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 8 }}>
                    <Text
                        accessibilityRole="header"
                        style={{ color: theme.colors.text.primary, fontSize: 18, ...Typography.default('semiBold') }}
                    >
                        {t('ignorePrevious.title')}
                    </Text>
                    <Pressable
                        ref={closeRef}
                        testID="ip-approvals-close"
                        accessibilityRole="button"
                        accessibilityLabel={t('common.close')}
                        onPress={onClose}
                        hitSlop={8}
                        style={{ marginLeft: 'auto', padding: 6, minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 8 }}
                    >
                        <Icon name="x" size={18} color={theme.colors.text.secondary} />
                    </Pressable>
                </View>
                <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 16 }}>
                    <WaitingPanel history={history} onDirtyChange={onDirtyChange} onOpenSession={placement === 'fullscreen' ? onClose : undefined} />
                    {children}
                </ScrollView>
            </View>
        </Animated.View>
    );
}
