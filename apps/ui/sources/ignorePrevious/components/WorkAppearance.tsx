import * as React from 'react';
import { Platform } from 'react-native';

import { useDeskPref } from '../deskPrefs';
import { DeskPaintContext, terminalPalettes, useDeskPaint, type DeskPaint } from '../palette';

/** C owns its selected Terminal paint; Slip continues to use the existing light/dark bridge. */
export function useWorkPaint(): DeskPaint {
    const fallback = useDeskPaint();
    const [style] = useDeskPref('chatStyle');
    const [palette] = useDeskPref('terminalPalette');
    return React.useMemo(() => {
        if (style !== 'terminal') return fallback;
        const paint = terminalPalettes[palette];
        return {
            ...fallback,
            paint,
            borderWidth: 1,
            text: { ...fallback.text, primary: paint.ink, secondary: paint.mute },
            inset: paint.panel2,
            strongBorder: paint.edge,
            controlBorder: paint.rule,
            colours: { ...fallback.colours, red: paint.bad, work: paint.work, off: paint.off,
                idleSignal: paint.idleSignal, turnSignal: paint.turnSignal },
        };
    }, [fallback, style, palette]);
}

export function WorkAppearance({ children }: Readonly<{ children: React.ReactNode }>) {
    const value = useWorkPaint();
    const [style] = useDeskPref('chatStyle');
    return <DeskPaintContext.Provider value={value}>
        {Platform.OS === 'web' ? (
            <div data-ip-work-terminal={style === 'terminal' ? 'true' : undefined} style={{ display: 'contents' }}>
                <style>{`[data-ip-work-terminal="true"] :focus-visible { outline: 3px solid ${value.paint.ink}; outline-offset: -3px; }`}</style>
                {children}
            </div>
        ) : children}
    </DeskPaintContext.Provider>;
}
