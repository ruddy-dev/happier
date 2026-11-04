import * as React from 'react';
import { type StyleProp, type TextStyle, type TextProps } from 'react-native';
import { Text } from '@/components/ui/text/Text';
import { deskMonoFontFamily } from '../fonts/deskFont';
import { useCoordinatorComposerLayout } from '../model/coordinatorComposerInput';

/** Keeps the real control label and semantics while giving Terminal its signed notation. */
export function DeskActionLabel({ label, style, testID, count, countStyle, ...textProps }: { label: string; style?: StyleProp<TextStyle>; testID?: string; count?: number | null; countStyle?: StyleProp<TextStyle> } & Pick<TextProps, 'numberOfLines' | 'ellipsizeMode'>) {
    const { terminal, controlInk } = useCoordinatorComposerLayout();
    const hasCount = typeof count === 'number' && Number.isFinite(count) && count > 0;
    const caption = terminal ? `[${label}` : label;
    return <Text {...textProps} testID={testID} useDefaultTypography={!terminal} style={[style, controlInk ? { color: controlInk } : null, terminal ? { fontFamily: deskMonoFontFamily() } : null]}>{hasCount ? <>{caption}<Text useDefaultTypography={!terminal} style={[countStyle, controlInk ? { color: controlInk } : null, terminal ? { fontFamily: deskMonoFontFamily() } : null]}>{` (${count})`}</Text>{terminal ? ']' : null}</> : terminal ? `${caption}]` : caption}</Text>;
}
