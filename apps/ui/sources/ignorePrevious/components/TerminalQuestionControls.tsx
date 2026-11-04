import * as React from 'react';
import { Platform, Pressable, TouchableOpacity, type StyleProp, type TextStyle, type TouchableOpacityProps, type ViewStyle } from 'react-native';
import { Text } from '@/components/ui/text/Text';
import type { TranscriptQuestionColors } from '@/components/sessions/transcript/TranscriptAppearanceContext';
import { deskMonoFontFamily } from '../fonts/deskFont';

/** Shared binding leaves web/ordinary touchables and their events intact. */
export function QuestionControlButton({ terminal, activeOpacity, style, ...props }: TouchableOpacityProps & { terminal: boolean }) {
    if (terminal && Platform.OS !== 'web') {
        // RN TouchableOpacity strips host focus/blur events. Pressable forwards them via Pressability.
        return <Pressable {...props} focusable={props.focusable !== false && !props.disabled}
            style={({ pressed }) => [style, pressed && { opacity: activeOpacity }]} />;
    }
    return <TouchableOpacity {...props} activeOpacity={activeOpacity} style={style}
        {...(Platform.OS === 'web' && props.accessibilityState?.selected !== undefined ? { 'aria-pressed': props.accessibilityState.selected } : {})} />;
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
        options: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', gap: 6 },
        option: {
            alignSelf: 'flex-start', maxWidth: '100%', minWidth: 44, flexShrink: 1,
            borderRadius: 2, borderColor: colors.text, gap: 0,
            paddingHorizontal: 10, paddingVertical: 5,
        },
        // Override the ordinary flex: 1 so short choices keep their intrinsic width.
        optionContent: { flex: 0, flexGrow: 0, flexShrink: 1, flexBasis: 'auto', minWidth: 0 },
        unavailable: { borderColor: colors.secondary, backgroundColor: 'transparent' },
        unavailableText: { color: colors.secondary },
        focusedOption: {
            backgroundColor: colors.text, borderColor: colors.text, borderWidth: 2,
            paddingHorizontal: 9, paddingVertical: 4,
        },
        focusedText: { color: colors.onAccent },
        inputFrame: {
            flexDirection: 'row', alignItems: 'center', borderRadius: 2, borderWidth: 1,
            borderColor: colors.border, backgroundColor: colors.surface, paddingHorizontal: 10,
        },
        focusedInput: { borderColor: colors.text, borderWidth: 2, paddingHorizontal: 9 },
        input: { flex: 1, minWidth: 0, borderWidth: 0, borderRadius: 0, paddingHorizontal: 0, fontFamily },
        bracket: { color: colors.secondary },
        actions: { justifyContent: 'flex-start', flexWrap: 'wrap' },
        submit: {
            maxWidth: '100%', minWidth: 44, flexShrink: 1, borderRadius: 0,
            borderWidth: 1, borderColor: colors.text, backgroundColor: 'transparent',
            paddingHorizontal: 10, paddingVertical: 5, opacity: 1,
        },
        submitText: { fontFamily, color: colors.text, flexShrink: 1 },
        focusedSubmit: {
            backgroundColor: colors.text, borderColor: colors.text, borderWidth: 2,
            paddingHorizontal: 9, paddingVertical: 4,
        },
    } satisfies Record<string, ViewStyle | TextStyle>;
}
