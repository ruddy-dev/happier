import * as React from 'react';
import { Platform, Pressable, View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { Popover } from '@/components/ui/popover/Popover';
import { FloatingOverlay } from '@/components/ui/overlays/FloatingOverlay';
import { formatTokenUsageCount } from '@/components/sessions/usage/tokenUsageFormatting';
import type { Session } from '@/sync/domains/state/storageTypes';
import { t } from '@/text';
import { sessionContextMeter } from './ContextMeter';
import { useIpColours } from '../palette';
import { useDeskPopup } from '../popups/useDeskPopup';
import { DeskText } from '../typography/DeskText';

export function ContextGauge({ session }: { session: Session }) {
    const meter = sessionContextMeter(session);
    // Unmount the popup lifecycle as soon as its report disappears.
    return meter ? <ReportedContextGauge key={session.id} meter={meter} /> : null;
}

function ReportedContextGauge({ meter }: { meter: NonNullable<ReturnType<typeof sessionContextMeter>> }) {
    const { theme } = useUnistyles();
    const colours = useIpColours();
    const [mode, setMode] = React.useState<'closed' | 'preview' | 'pinned'>('closed');
    const openerRef = React.useRef<View>(null);
    const contentRef = React.useRef<View>(null);
    const suppressFocus = React.useRef(false);
    const keyboardFocused = React.useRef(false);
    const open = mode !== 'closed';
    const close = () => {
        suppressFocus.current = true;
        keyboardFocused.current = false;
        setMode('closed');
    };
    useDeskPopup({ open, onClose: close, openerRef, contentRef, returnFocusOnClose: mode === 'pinned' });
    const preview = () => { suppressFocus.current = false; if (mode === 'closed') setMode('preview'); };
    const leave = (event: React.MouseEvent<HTMLElement>) => {
        const next = event.relatedTarget;
        if (next instanceof Node && [openerRef.current, contentRef.current].some(node => node instanceof HTMLElement && node.contains(next))) return;
        if (mode === 'preview' && !keyboardFocused.current) close();
    };
    const pointerProps = Platform.OS === 'web' ? { onMouseEnter: preview, onMouseLeave: leave } : {};
    const percent = t('ignorePrevious.contextGauge.percent', { percent: meter.percent });
    const counts = { used: formatTokenUsageCount(meter.used), limit: formatTokenUsageCount(meter.limit) };
    const sentence = meter.towardsCompact ? t('ignorePrevious.contextToCompact', counts) : t('ignorePrevious.contextOfWindow', counts);
    const windowDescription = meter.windowTokens
        ? t('ignorePrevious.contextWindow', { size: formatTokenUsageCount(meter.windowTokens) })
        : t('ignorePrevious.contextGauge.windowUnknown');
    const limitSource = meter.towardsCompact && meter.compactSetting
        ? t('ignorePrevious.contextGauge.limitSource', { setting: meter.compactSetting })
        : t('ignorePrevious.contextGauge.windowSource');
    const secondary = { color: theme.colors.text.secondary, fontSize: 12 };
    return <>
        <Pressable ref={openerRef} testID="ip-context-gauge" accessibilityRole="button"
            accessibilityLabel={t('ignorePrevious.contextGauge.label', { percent, sentence })}
            accessibilityState={{ expanded: open }} aria-expanded={open}
            {...pointerProps}
            onFocus={() => {
                keyboardFocused.current = !suppressFocus.current && Platform.OS === 'web'
                    && openerRef.current instanceof HTMLElement && openerRef.current.matches(':focus-visible');
                if (keyboardFocused.current && mode === 'closed') setMode('preview');
                suppressFocus.current = false;
            }}
            onBlur={() => { keyboardFocused.current = false; suppressFocus.current = false; if (mode === 'preview') close(); }}
            onPress={() => { if (mode === 'pinned') close(); else setMode('pinned'); }}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 8, minHeight: Platform.OS === 'web' ? 28 : 48, borderRadius: 8 }}>
            <DeskText style={{ color: theme.colors.text.primary, fontSize: 13, fontWeight: '600' }}>{percent}</DeskText>
            <View aria-hidden accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
                style={{ width: 46, height: 5, borderRadius: 3, backgroundColor: theme.colors.surface.inset, overflow: 'hidden' }}>
                <View testID="ip-context-gauge-fill" style={{ width: `${meter.ratio * 100}%`, height: '100%', backgroundColor: meter.percent >= 90 ? colours.red : colours.yellow }} />
            </View>
        </Pressable>
        <DeskText testID="ip-context-announcement" accessibilityLiveRegion="polite"
            style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', opacity: 0 }}>
            {open ? `${sentence} ${windowDescription} ${limitSource}` : ''}
        </DeskText>
        <Popover open={open} anchorRef={openerRef} placement="top" portal={{ web: true }} gap={0}
            {...(Platform.OS === 'web' ? { backdrop: false as const } : { backdrop: true as const, onRequestClose: close })}
            maxWidthCap={290} edgePadding={8}>
            {({ maxHeight }) => <View ref={contentRef} testID="ip-context-popover" {...pointerProps}
                style={{ paddingBottom: 8 }}>
                <FloatingOverlay maxHeight={maxHeight} containerStyle={{ width: 290, maxWidth: '100%', padding: 12, gap: 6 }}>
                    <DeskText style={{ color: theme.colors.text.primary }}>{sentence}</DeskText>
                    <DeskText style={secondary}>{windowDescription}</DeskText>
                    <DeskText style={secondary}>{limitSource}</DeskText>
                </FloatingOverlay>
            </View>}
        </Popover>
    </>;
}
