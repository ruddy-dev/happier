import { useDeskPref } from '../deskPrefs';
import { terminalPalettes, useDeskPaint } from '../palette';

/** Phone controls follow the selected chat skin, including every Terminal palette. */
export function usePhoneControlPaint() {
    const [style] = useDeskPref('chatStyle');
    const [palette] = useDeskPref('terminalPalette');
    const desk = useDeskPaint();
    return { terminal: style === 'terminal', paint: style === 'terminal' ? terminalPalettes[palette] : desk.paint };
}
