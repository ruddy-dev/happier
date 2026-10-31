import { useUnistyles } from 'react-native-unistyles';

import type { Bulb } from './model/bulb';

/**
 * The Ignore Previous overlay's own colours: the mask's yellow and ink, and the four antenna-bulb
 * states. Everything else in the overlay uses Happier's theme tokens. This is the one place raw
 * colour values live (see apps/ui/AGENTS.md, "named, theme-aware palette in one domain module").
 * Yellow stays the same in both themes because it is the brand colour; the bulb colours shift so
 * each reads against the light and dark surfaces.
 */
export type IpColours = Readonly<{
    yellow: string;
    red: string;
    work: string;
    off: string;
    ink: string;
    bone: string;
    visor: string;
    /** The placeholder shoggoth behind the mask (ShogView): its body, outline and unlit eyes. */
    flesh: string;
    fleshEdge: string;
    paleEye: string;
}>;

export const ipPalette: Readonly<{ light: IpColours; dark: IpColours }> = {
    dark: { yellow: '#ffcf1f', red: '#e0301e', work: '#c9c2b0', off: '#3a3e49', ink: '#14161c', bone: '#f3ecd8', visor: '#ffffff', flesh: '#3b4a3f', fleshEdge: '#5c7262', paleEye: '#e8e2cf' },
    light: { yellow: '#ffcf1f', red: '#c9230f', work: '#6f6a5e', off: '#cfc7b0', ink: '#14161c', bone: '#14161c', visor: '#ffffff', flesh: '#55695a', fleshEdge: '#2f3b33', paleEye: '#f3ecd8' },
};

export function useIpColours(): IpColours {
    const { theme } = useUnistyles();
    return theme.dark ? ipPalette.dark : ipPalette.light;
}

export function bulbColour(colours: IpColours, bulb: Bulb): string {
    switch (bulb) {
        case 'turn':
            return colours.yellow;
        case 'stuck':
            return colours.red;
        case 'working':
            return colours.work;
        case 'idle':
            return colours.off;
    }
}
