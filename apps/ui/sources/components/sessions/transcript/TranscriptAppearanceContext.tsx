import * as React from 'react';
import type { StyleProp, ViewStyle } from 'react-native';

/** Native controls need explicit ink, surfaces and selected-state pairs. Question-only. */
export type TranscriptQuestionColors = Readonly<{
    text: string;
    secondary: string;
    surface: string;
    border: string;
    accent: string;
    onAccent: string;
    button: string;
    buttonText: string;
}>;

/** Optional transcript presentation. The default preserves the host app's appearance. */
export type TranscriptAppearance = Readonly<{
    userBubbleStyle?: StyleProp<ViewStyle>;
    agentContainerStyle?: StyleProp<ViewStyle>;
    toolContainerStyle?: StyleProp<ViewStyle>;
    fontFamily?: string;
    questionColors?: TranscriptQuestionColors;
    agentLeading?: React.ReactNode;
    userLeading?: React.ReactNode;
    // Native text does not inherit View colours. Markdown owns its text and inset surfaces.
    markdownColors?: Readonly<{
        text: { primary: string; secondary: string; link: string };
        surface: { inset: string; elevated: string; selected: string };
        border: { default: string };
    }>;
}>;

export const TranscriptAppearanceContext = React.createContext<TranscriptAppearance | null>(null);

// Kept separate from appearance: tool content resets text styling, but nested transcripts
// must retain the coordinator's grouping scope. Null preserves account preferences.
export const TranscriptToolCallsGroupingContext = React.createContext<'collapsed-per-turn' | null>(null);
