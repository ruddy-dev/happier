import { useUnistyles } from 'react-native-unistyles';
import { Typography } from '@/constants/Typography';
import { useDeskPref } from '../deskPrefs';
import { DESK_FONT_STACK } from '../fonts/deskFont';
import { terminalPalettes } from '../palette';

/** Region G presentation. Request state and permission policy stay with their existing owners. */
export function useWaitingAppearance() {
    const { theme } = useUnistyles();
    const [chatStyle] = useDeskPref('chatStyle');
    const [palette] = useDeskPref('terminalPalette');
    const terminal = chatStyle === 'terminal';
    const paint = terminalPalettes[palette];
    const ink = terminal ? paint.ink : theme.colors.text.primary;
    const mute = terminal ? paint.mute : theme.colors.text.secondary;
    const rule = terminal ? paint.rule : theme.colors.border.default;
    const styles = {
        card: { gap: 6, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: rule },
        title: { color: ink, fontSize: 15, ...(terminal ? { fontFamily: DESK_FONT_STACK, fontWeight: '700' as const } : {}) },
        button: {
            paddingHorizontal: terminal ? 10 : 12,
            paddingVertical: 8,
            minHeight: 48,
            justifyContent: 'center',
            borderRadius: terminal ? 2 : 10,
            borderWidth: 1,
            borderColor: rule,
            backgroundColor: terminal ? paint.panel : theme.colors.surface.inset,
        },
        buttonText: { color: ink, fontSize: terminal ? 12.5 : 14,
            ...(terminal ? { fontFamily: DESK_FONT_STACK, fontWeight: '500' as const } : Typography.default('semiBold')) },
        secondary: { color: mute, fontSize: 13 },
    } as const;
    return { terminal, paint, ink, mute, rule, styles };
}
