import { useDeskPref } from '../deskPrefs';
import { terminalPalettes, useDeskPaint } from '../palette';

/** Region B shares the selected desk palette, including its mask and attention pill. */
export function useTopBarAppearance() {
    const [style] = useDeskPref('chatStyle');
    const [palette] = useDeskPref('terminalPalette');
    const desk = useDeskPaint();
    const terminal = style === 'terminal';
    const paint = terminal ? terminalPalettes[palette] : desk.paint;
    const maskColours = terminal ? {
        ...desk.colours, bone: paint.maskrim, red: paint.brandred,
        yellow: paint.yel, work: paint.work, off: paint.off,
        idleSignal: paint.idleSignal, turnSignal: paint.turnSignal,
    } : desk.colours;
    return { terminal, paint, maskColours };
}
