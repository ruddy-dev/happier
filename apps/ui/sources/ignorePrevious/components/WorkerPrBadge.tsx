import * as React from 'react';
import { Platform, Pressable, View } from 'react-native';

import { useSessionProjectScmSnapshot } from '@/sync/store/hooks';
import { t } from '@/text';
import { isTauriDesktop } from '@/utils/platform/tauri';
import { normalizeExternalUrl, openExternalUrl } from '@/utils/url/openExternalUrl';

import { buildWorkerPrBadge } from '../model/workerPrBadge';
import { useDeskNow } from '../model/useDeskNow';
import { useDeskPaint } from '../palette';
import { DeskText } from '../typography/DeskText';

/** Store subscription only: mounting a worker badge must never request SCM refresh. */
export function WorkerPrBadge({ sessionId }: { sessionId: string }) {
    const snapshot = useSessionProjectScmSnapshot(sessionId);
    const now = useDeskNow();
    const { paint } = useDeskPaint();
    const badge = buildWorkerPrBadge(snapshot, now);
    if (!badge) return null;
    const url = normalizeExternalUrl(badge.url);

    const state = t(`ignorePrevious.pullRequest.${badge.state}`);
    const label = t('ignorePrevious.pullRequest.badge', { number: badge.numberLabel, state });
    const asOf = badge.old && badge.fetchedAt !== null
        ? t('ignorePrevious.pullRequest.asOf', {
            time: new Date(badge.fetchedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }),
        }) : null;
    const signal = badge.old ? paint.mute : badge.state === 'open' ? paint.ok : badge.state === 'merged' ? paint.hl : paint.bad;

    const props = {
        testID: `ip-worker-pr-${sessionId}`,
        accessibilityRole: 'link' as const,
        accessibilityLabel: asOf ? `${label}. ${asOf}` : label,
        style: { justifyContent: 'center' as const, minHeight: Platform.select({ ios: 44, android: 48, default: 28 }) },
    };
    const content = (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, flexShrink: 0, borderWidth: 1, borderColor: paint.mute, borderRadius: 999, paddingHorizontal: 9, minHeight: 28 }}>
            <View accessible={false} style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: signal }} />
            <DeskText style={{ color: badge.old ? paint.mute : paint.ink, fontSize: 13, fontWeight: '600' }}>{label}</DeskText>
        </View>
    );

    if (Platform.OS === 'web') {
        const desktop = isTauriDesktop();
        // Use RN Web's anchor directly: Pressable skips Alt-click. The browser
        // supplies Enter's click; no keyboard synthesis is needed here.
        const webProps = {
            href: url ?? undefined,
            hrefAttrs: { target: '_blank', rel: 'noopener noreferrer' },
            tabIndex: 0 as const,
            onClick: (event: React.MouseEvent<HTMLElement>) => {
                if (url === null) {
                    event.preventDefault();
                    return;
                }
                if (!desktop && (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)) return;
                event.preventDefault();
                void openExternalUrl(url);
            },
            onAuxClick: (event: React.MouseEvent<HTMLElement>) => {
                if (!desktop) return;
                event.preventDefault();
                if (event.button === 1 && url !== null) void openExternalUrl(url);
            },
            onContextMenu: (event: React.MouseEvent<HTMLElement>) => {
                // WebView navigation must stay with Tauri's system-browser adapter.
                if (desktop) event.preventDefault();
            },
        };
        const webStyle = { cursor: 'pointer' as const, touchAction: 'manipulation' as const };
        return <View {...props} {...webProps} style={[webStyle, props.style]}>{content}</View>;
    }

    return <Pressable {...props} onPress={() => { if (url !== null) void openExternalUrl(url); }}>{content}</Pressable>;
}
