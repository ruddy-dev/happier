import * as React from 'react';
import { Platform, View } from 'react-native';
import { t } from '@/text';
import { useDeskPref } from '../deskPrefs';
import { deskThemes, terminalPalettes, useDeskPaint, type SpriteTheme } from '../palette';
import { deskMonoFontFamily } from '../fonts/deskFont';
import { CoordinatorComposerInputContext, createCoordinatorComposerObserver } from '../model/coordinatorComposerInput';
import { useDeskWaitsSummary } from '../model/useDeskWaits';
import { CoordinatorPrompts } from './CoordinatorPrompts';
import { DeskText } from '../typography/DeskText';

/** Per-composer opt-in around the real SessionView and the synthetic screenshot body alike. */
export function CoordinatorComposer({ children, coordinatorId, phone = false }: React.PropsWithChildren<{ coordinatorId?: string; phone?: boolean }>) {
    return Platform.OS === 'web' ? <WebCoordinatorComposer coordinatorId={coordinatorId} phone={phone}>{children}</WebCoordinatorComposer> :
        <NativeCoordinatorComposer coordinatorId={coordinatorId} phone={phone}>{children}</NativeCoordinatorComposer>;
}

function NativeCoordinatorComposer({ children, coordinatorId, phone }: React.PropsWithChildren<{ coordinatorId?: string; phone: boolean }>) {
    const [observer] = React.useState(createCoordinatorComposerObserver);
    const [style] = useDeskPref('chatStyle');
    const { paint, borderWidth } = useDeskPaint();
    const [palette] = useDeskPref('terminalPalette');
    const activePaint = style === 'terminal' ? terminalPalettes[palette] : paint;
    const panelStyle = React.useMemo(() => style === 'mask' ? slipPanelStyle(paint, borderWidth) :
        { backgroundColor: activePaint.bg, borderColor: activePaint.edge, borderWidth: 1, borderRadius: 0 }, [style, paint, borderWidth, activePaint]);
    const context = React.useMemo(() => ({ observer, prompt: null, panelFooter: null, phone, terminal: style === 'terminal', panelStyle, controlInk: activePaint.ink,
        panelBackground: panelStyle.backgroundColor,
        submitColors: { background: activePaint.yel, tint: activePaint.yelink },
        textStyle: { fontFamily: deskMonoFontFamily(), color: activePaint.ink }, placeholderColor: activePaint.mute,
        panelLeading: phone && coordinatorId ? <PhoneShortcuts observer={observer} coordinatorId={coordinatorId} /> : null }), [observer, coordinatorId, phone, panelStyle, style, activePaint]);
    return <CoordinatorComposerInputContext.Provider value={context}>{children}</CoordinatorComposerInputContext.Provider>;
}

function WebCoordinatorComposer({ children, coordinatorId, phone }: React.PropsWithChildren<{ coordinatorId?: string; phone: boolean }>) {
    const [observer] = React.useState(createCoordinatorComposerObserver);
    const [style] = useDeskPref('chatStyle');
    const { paint: slipPaint, borderWidth: slipBorderWidth } = useDeskPaint();
    const [palette] = useDeskPref('terminalPalette');
    const paint = terminalPalettes[palette];
    const terminal = style === 'terminal';
    const scope = `ip-composer-${React.useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
    const context = React.useMemo(() => {
        const panelStyle = terminal ? undefined : slipPanelStyle(slipPaint, slipBorderWidth);
        return {
            observer,
            phone,
            terminal,
            controlInk: terminal ? paint.ink : slipPaint.ink,
            panelBackground: panelStyle?.backgroundColor ?? paint.bg,
            submitColors: { background: terminal ? paint.yel : slipPaint.yel, tint: terminal ? paint.yelink : slipPaint.yelink },
            panelStyle,
            prompt: terminal ? <DeskText testID="ip-composer-prompt" aria-hidden style={{ color: paint.user, fontSize: 13, fontWeight: '700' }}>
                {t('ignorePrevious.composer.prompt')}<DeskText style={{ color: paint.mute }}>{' ~ '}</DeskText>{'> '}
            </DeskText> : null,
            panelLeading: phone && coordinatorId ? <PhoneShortcuts observer={observer} coordinatorId={coordinatorId} /> : null,
            panelFooter: terminal ? <ComposerStatusStrip observer={observer} paint={paint} /> : null,
            textStyle: { fontFamily: deskMonoFontFamily(), color: terminal ? paint.ink : slipPaint.ink },
        };
    }, [observer, terminal, paint, slipPaint, slipBorderWidth, phone, coordinatorId]);
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
        ${selector} [data-testid="session-composer-input"] { caret-color: ${paint.yel} !important; }
        ${selector} [data-testid="session-composer-input"]::placeholder { color: ${paint.mute}; opacity: 1; }
    ` : '';
    return <CoordinatorComposerInputContext.Provider value={context}>
        <View nativeID={scope} style={{ flex: 1, minHeight: 0 }}>
            <style>{chrome}</style>
            <View style={{ flex: 1, minHeight: 0 }}>{children}</View>
        </View>
    </CoordinatorComposerInputContext.Provider>;
}

function ComposerStatusStrip({ observer, paint }: {
    observer: ReturnType<typeof createCoordinatorComposerObserver>; paint: (typeof terminalPalettes)[keyof typeof terminalPalettes];
}) {
    const draft = React.useSyncExternalStore(observer.subscribe, observer.getSnapshot, observer.getSnapshot);
    const waits = useDeskWaitsSummary();
    const cell = { paddingHorizontal: 9, paddingVertical: 4, fontSize: 12 };
    return <View testID="ip-composer-status-strip" style={{ flexDirection: 'row', flexWrap: 'wrap', flexShrink: 0, width: '100%',
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
    </View>;
}

function PhoneShortcuts({ observer, coordinatorId }: { observer: ReturnType<typeof createCoordinatorComposerObserver>; coordinatorId: string }) {
    const writing = React.useSyncExternalStore(observer.subscribe, () => observer.getSnapshot().writing, () => false);
    return writing ? null : <CoordinatorPrompts coordinatorId={coordinatorId} phone />;
}

/** Mockup 12 uses the desk background, except Paper's white input panel. */
function slipPanelStyle(paint: SpriteTheme, borderWidth: number) {
    return { backgroundColor: paint === deskThemes.paper ? paint.panel2 : paint.bg, borderColor: paint.edge,
        borderWidth, borderTopLeftRadius: 18, borderTopRightRadius: 18, borderBottomRightRadius: 18, borderBottomLeftRadius: 8 };
}
