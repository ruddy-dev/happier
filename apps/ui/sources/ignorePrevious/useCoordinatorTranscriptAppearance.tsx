import * as React from 'react';

import { Text } from '@/components/ui/text/Text';

import { TranscriptAppearanceContext, TranscriptToolCallsGroupingContext, type TranscriptAppearance } from '@/components/sessions/transcript/TranscriptAppearanceContext';

import { MaskFace } from './components/MaskFace';
import { useDeskPref } from './deskPrefs';
import { DESK_FONT_STACK } from './fonts/deskFont';
import { terminalPalettes, useDeskPaint } from './palette';

const maskAppearance: TranscriptAppearance = {
    fontFamily: DESK_FONT_STACK,
    agentLeading: <MaskFace size={28} bulb="rest" testID="ip-coordinator-message-mask" />,
};

export function CoordinatorTranscriptAppearanceProvider({ children }: React.PropsWithChildren) {
    const appearance = useCoordinatorTranscriptAppearance();
    const [style] = useDeskPref('chatStyle');
    return (
        <TranscriptToolCallsGroupingContext.Provider value={style === 'terminal' ? 'collapsed-per-turn' : null}>
            <TranscriptAppearanceContext.Provider value={appearance}>{children}</TranscriptAppearanceContext.Provider>
        </TranscriptToolCallsGroupingContext.Provider>
    );
}

export function useCoordinatorTranscriptAppearance(): TranscriptAppearance {
    const [style] = useDeskPref('chatStyle');
    const [palette] = useDeskPref('terminalPalette');
    const desk = useDeskPaint();
    return React.useMemo(() => {
        const paint = style === 'terminal' ? terminalPalettes[palette] : desk.paint;
        const shellColors = { background: paint.panel, primary: paint.ink, secondary: paint.mute };
        if (style !== 'terminal') return { ...maskAppearance, shellColors };
        return {
            fontFamily: DESK_FONT_STACK,
            shellColors,
            questionColors: {
                text: paint.ink, secondary: paint.mute, surface: paint.panel2,
                border: paint.mute, accent: paint.hl, onAccent: paint.bg,
                button: paint.yel, buttonText: paint.yelink,
            },
            userLeading: <Text accessibilityElementsHidden importantForAccessibility="no" style={{ color: paint.hl, fontFamily: DESK_FONT_STACK }}>{'> '}</Text>,
            userBubbleStyle: { backgroundColor: paint.panel, borderRadius: 0 },
            agentContainerStyle: {
                backgroundColor: paint.bg, borderRadius: 0,
                borderLeftWidth: 2, borderLeftColor: paint.bot, paddingLeft: 12,
            },
            toolContainerStyle: { borderRadius: 0 },
            markdownColors: {
                text: { primary: paint.ink, secondary: paint.mute, link: paint.hl },
                surface: { inset: paint.panel, elevated: paint.panel2, selected: paint.panel2 },
                border: { default: paint.rule },
            },
        };
    }, [style, palette, desk.paint]);
}
