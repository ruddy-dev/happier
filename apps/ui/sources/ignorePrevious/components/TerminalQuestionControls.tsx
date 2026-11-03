import * as React from 'react';
import type { StyleProp, TextStyle, ViewStyle } from 'react-native';
import { Text } from '@/components/ui/text/Text';
import type { TranscriptQuestionColors } from '@/components/sessions/transcript/TranscriptAppearanceContext';
import { DESK_FONT_STACK } from '../fonts/deskFont';

/** Decoration stays outside answer values and the accessibility tree. */
export function QuestionControlBracket({ children, style }: { children: string; style?: StyleProp<TextStyle> }) {
    return <Text accessible={false} accessibilityElementsHidden importantForAccessibility="no" aria-hidden={true} style={[style, { fontFamily: DESK_FONT_STACK }]}>{children}</Text>;
}

/** Consumes the public question paint supplied only by Terminal desk appearance. */
export function terminalQuestionControlStyles(colors: TranscriptQuestionColors) {
    return {
        text: { fontFamily: DESK_FONT_STACK },
        option: { borderRadius: 2, borderColor: colors.text, gap: 0 },
        unavailable: { borderColor: colors.secondary, backgroundColor: 'transparent' },
        unavailableText: { color: colors.secondary },
        focusedOption: {
            backgroundColor: colors.text, borderColor: colors.text, borderWidth: 2,
            paddingHorizontal: 11, paddingVertical: 11,
        },
        focusedText: { color: colors.onAccent },
        inputFrame: {
            flexDirection: 'row', alignItems: 'center', borderRadius: 2, borderWidth: 1,
            borderColor: colors.border, backgroundColor: colors.surface, paddingHorizontal: 10,
        },
        focusedInput: { borderColor: colors.text, borderWidth: 2, paddingHorizontal: 9 },
        input: { flex: 1, minWidth: 0, borderWidth: 0, borderRadius: 0, paddingHorizontal: 0, fontFamily: DESK_FONT_STACK },
        bracket: { color: colors.secondary },
    } satisfies Record<string, ViewStyle | TextStyle>;
}
