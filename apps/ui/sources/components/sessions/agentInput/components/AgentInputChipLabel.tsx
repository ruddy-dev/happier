import * as React from 'react';

import { DeskActionLabel } from '@/ignorePrevious/components/DeskActionLabel';

export const AgentInputChipLabel = React.memo(function AgentInputChipLabel(props: Readonly<{
    label: string;
    count?: number | null;
    textStyle?: any;
    countTextStyle?: any;
}>) {
    return <DeskActionLabel numberOfLines={1} label={props.label} style={props.textStyle} count={props.count} countStyle={props.countTextStyle} />;
});
