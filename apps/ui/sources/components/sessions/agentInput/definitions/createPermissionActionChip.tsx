import * as React from 'react';
import { Pressable, type View } from 'react-native';

import { normalizeNodeForView } from '@/components/ui/rendering/normalizeNodeForView';
import { DeskActionLabel } from '@/ignorePrevious/components/DeskActionLabel';
import { Icon } from '@/components/ui/icons/Icon';
import { AGENT_INPUT_CHIP_ICON_SIZE_PX, AGENT_INPUT_CHIP_ICON_STYLE } from './agentInputChipIconMetrics';

export function createPermissionActionChip(params: Readonly<{
    anchorRef: React.RefObject<View | null>;
    tint: string;
    showLabel: boolean;
    label: string | null;
    chipStyle: (pressed: boolean) => any;
    textStyle: any;
    onPress: () => void;
}>): React.ReactNode {
    const testID = 'agent-input-permission-chip';
    return (
        <Pressable
            ref={params.anchorRef}
            key="permission"
            testID={testID}
            onPress={params.onPress}
            hitSlop={{ top: 5, bottom: 10, left: 0, right: 0 }}
            style={(state) => params.chipStyle(state.pressed)}
        >
            {normalizeNodeForView(<Icon name="shield-check" size={AGENT_INPUT_CHIP_ICON_SIZE_PX} color={params.tint} style={AGENT_INPUT_CHIP_ICON_STYLE} />)}
            {params.showLabel && params.label ? (
                <DeskActionLabel style={params.textStyle} label={params.label} />
            ) : null}
        </Pressable>
    );
}
