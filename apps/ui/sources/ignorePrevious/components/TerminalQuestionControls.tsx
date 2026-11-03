import * as React from 'react';
import { Platform, Pressable, TouchableOpacity, type StyleProp, type TextStyle, type TouchableOpacityProps, type ViewStyle } from 'react-native';
import { Text } from '@/components/ui/text/Text';
import type { TranscriptQuestionColors } from '@/components/sessions/transcript/TranscriptAppearanceContext';
import { deskMonoFontFamily } from '../fonts/deskFont';

/** Shared selection binding leaves web/ordinary touchables and their events intact. */
export function QuestionOptionButton({ terminal, activeOpacity, style, ...props }: TouchableOpacityProps & { terminal: boolean }) {
    if (terminal && Platform.OS !== 'web') {
        // RN TouchableOpacity strips host focus/blur events. Pressable forwards them via Pressability.
        return <Pressable {...props} focusable={props.focusable !== false && !props.disabled}
            style={({ pressed }) => [style, pressed && { opacity: activeOpacity }]} />;
    }
    return <TouchableOpacity {...props} activeOpacity={activeOpacity} style={style}
        {...(Platform.OS === 'web' ? { 'aria-pressed': props.accessibilityState?.selected === true } : {})} />;
}

/** Decoration stays outside answer values and the accessibility tree. */
export function QuestionControlBracket({ children, style }: { children: string; style?: StyleProp<TextStyle> }) {
    return <Text accessible={false} accessibilityElementsHidden importantForAccessibility="no" aria-hidden={true} style={[style, { fontFamily: deskMonoFontFamily() }]}>{children}</Text>;
}

/** Consumes the public question paint supplied only by Terminal desk appearance. */
export function terminalQuestionControlStyles(colors: TranscriptQuestionColors) {
    const fontFamily = deskMonoFontFamily();
    return {
        text: { fontFamily },
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
        input: { flex: 1, minWidth: 0, borderWidth: 0, borderRadius: 0, paddingHorizontal: 0, fontFamily },
        bracket: { color: colors.secondary },
    } satisfies Record<string, ViewStyle | TextStyle>;
}
