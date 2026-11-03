import * as React from 'react';

import { type TranscriptAppearance } from '@/components/sessions/transcript/TranscriptAppearanceContext';

import { MaskFace } from './components/MaskFace';
import { useDeskPref } from './deskPrefs';
import { DESK_FONT_STACK } from './fonts/deskFont';
import { terminalPalettes } from './palette';

const maskAppearance: TranscriptAppearance = {
    fontFamily: DESK_FONT_STACK,
    agentLeading: <MaskFace size={28} bulb="rest" testID="ip-coordinator-message-mask" />,
};

export function useCoordinatorTranscriptAppearance(): TranscriptAppearance {
    const [style] = useDeskPref('chatStyle');
    const [palette] = useDeskPref('terminalPalette');
    return React.useMemo(() => {
        if (style !== 'terminal') return maskAppearance;
        const paint = terminalPalettes[palette];
        return {
            fontFamily: DESK_FONT_STACK,
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
    }, [style, palette]);
}
