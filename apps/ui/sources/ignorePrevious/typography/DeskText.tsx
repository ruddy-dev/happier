import * as React from 'react';

import { Text, type AppTextProps } from '@/components/ui/text/Text';
import { DESK_FONT_STACK } from '../fonts/deskFont';

export function DeskText({ style, ...props }: Omit<AppTextProps, 'useDefaultTypography'>) {
    return <Text {...props} useDefaultTypography={false} style={[{ fontFamily: DESK_FONT_STACK }, style]} />;
}
