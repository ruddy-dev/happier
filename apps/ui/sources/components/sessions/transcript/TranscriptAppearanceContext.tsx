import * as React from 'react';
import type { StyleProp, ViewStyle } from 'react-native';

/** Optional transcript presentation. The default preserves the host app's appearance. */
export type TranscriptAppearance = Readonly<{
    userBubbleStyle?: StyleProp<ViewStyle>;
    agentContainerStyle?: StyleProp<ViewStyle>;
    toolContainerStyle?: StyleProp<ViewStyle>;
    fontFamily?: string;
    agentLeading?: React.ReactNode;
    // Native text does not inherit View colours. Markdown owns its text and inset surfaces.
    markdownColors?: Readonly<{
        text: { primary: string; secondary: string; link: string };
        surface: { inset: string; elevated: string; selected: string };
        border: { default: string };
    }>;
}>;

export const TranscriptAppearanceContext = React.createContext<TranscriptAppearance | null>(null);
