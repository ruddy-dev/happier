import * as React from 'react';
import { Platform, useWindowDimensions, View } from 'react-native';
import { t } from '@/text';
import { layout } from '@/components/ui/layout/layout';
import { useDeskPref } from '../deskPrefs';
import { terminalPalettes } from '../palette';
import { DESK_FONT_STACK } from '../fonts/deskFont';
import { CoordinatorComposerInputContext, createCoordinatorComposerObserver } from '../model/coordinatorComposerInput';
import { useDeskWaitsSummary } from '../model/useDeskWaits';
import { DeskText } from '../typography/DeskText';

/** Web-only opt-in around the real SessionView and the synthetic screenshot body alike. */
export function CoordinatorComposer({ children }: React.PropsWithChildren) {
    return Platform.OS === 'web' ? <WebCoordinatorComposer>{children}</WebCoordinatorComposer> : <>{children}</>;
}

function WebCoordinatorComposer({ children }: React.PropsWithChildren) {
    const [observer] = React.useState(createCoordinatorComposerObserver);
    const [style] = useDeskPref('chatStyle');
    const [palette] = useDeskPref('terminalPalette');
    const paint = terminalPalettes[palette];
    const terminal = style === 'terminal';
    const scope = `ip-composer-${React.useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
    const context = React.useMemo(() => ({
        observer,
        prompt: terminal ? <DeskText testID="ip-composer-prompt" aria-hidden style={{ color: paint.user, fontSize: 13, fontWeight: '700' }}>
            {t('ignorePrevious.composer.prompt')}<DeskText style={{ color: paint.mute }}>{' ~ '}</DeskText>{'> '}
        </DeskText> : null,
        textStyle: terminal ? { fontFamily: DESK_FONT_STACK, color: paint.ink } : undefined,
    }), [observer, terminal, paint]);
    // CSS changes only this instance's existing web composer hosts. It neither discovers inputs
    // nor changes controls, focus, permission labels, context data or native layout.
    const selector = `#${scope}`;
    const chrome = terminal ? `
        ${selector} [data-testid="agent-input-drop-zone"] { background: ${paint.bg} !important; border: 1px solid ${paint.edge} !important; border-radius: 0 !important; box-shadow: none !important; }
        ${selector} [data-testid="agent-input-drop-zone"]:focus-within { border-color: ${paint.yel} !important; }
        ${selector} [data-testid="agent-input-root"] { padding-bottom: 0 !important; }
        ${selector} [data-testid="agent-input-action-footer"] { border-radius: 0 !important; }
        ${selector} [data-testid="ip-run-settings"], ${selector} [data-testid="agent-input-permission-chip"] { border: 1px solid ${paint.edge} !important; border-radius: 2px !important; }
        ${selector} [data-testid="session-composer-send"] { border-radius: 2px !important; }
        ${selector} [data-testid="session-composer-send"]:not([aria-disabled="true"]) { background: ${paint.yel} !important; color: ${paint.yelink} !important; }
        ${selector} [data-testid="session-composer-send"]:not([aria-disabled="true"]) * { color: ${paint.yelink} !important; }
        ${selector} [data-testid="session-composer-input"] { caret-color: ${paint.yel} !important; }
        ${selector} [data-testid="session-composer-input"]::placeholder { color: ${paint.mute}; opacity: 1; }
    ` : '';
    return <CoordinatorComposerInputContext.Provider value={context}>
        <View nativeID={scope} style={{ flex: 1, minHeight: 0 }}>
            <style>{chrome}</style>
            <View style={{ flex: 1, minHeight: 0 }}>{children}</View>
            {terminal ? <ComposerStatusStrip observer={observer} paint={paint} /> : null}
        </View>
    </CoordinatorComposerInputContext.Provider>;
}

function ComposerStatusStrip({ observer, paint }: {
    observer: ReturnType<typeof createCoordinatorComposerObserver>; paint: (typeof terminalPalettes)[keyof typeof terminalPalettes];
}) {
    const draft = React.useSyncExternalStore(observer.subscribe, observer.getSnapshot, observer.getSnapshot);
    const waits = useDeskWaitsSummary();
    const { width } = useWindowDimensions();
    const cell = { paddingHorizontal: 9, paddingVertical: 4, fontSize: 12 };
    return <View style={{ paddingHorizontal: width > 700 ? 16 : 8, paddingBottom: 8 }}>
        <View testID="ip-composer-status-strip" style={{ flexDirection: 'row', flexWrap: 'wrap', alignSelf: 'center', width: '100%', maxWidth: layout.maxWidth,
            borderTopWidth: 1, borderColor: paint.rule, backgroundColor: paint.bg }}>
            <DeskText testID="ip-composer-draft-status" style={{ ...cell, color: paint.bg, backgroundColor: draft.writing ? paint.user : paint.bot, fontWeight: '700' }}>
                {t(draft.writing ? 'ignorePrevious.composer.writing' : 'ignorePrevious.composer.ready')}
            </DeskText>
            {draft.multiline ? <DeskText testID="ip-composer-position" style={{ ...cell, color: paint.ink, backgroundColor: paint.panel2 }}>
                {t('ignorePrevious.composer.position', { line: draft.line, column: draft.column })}
            </DeskText> : null}
            <View style={{ flex: 1 }} />
            <DeskText testID="ip-composer-waiting" style={{ ...cell, color: paint.yelink, backgroundColor: paint.yel, fontWeight: '700' }}>
                {waits.ready ? t('ignorePrevious.composer.waiting', { count: waits.count }) : t('ignorePrevious.composer.waitingUnknown')}
            </DeskText>
        </View>
    </View>;
}
