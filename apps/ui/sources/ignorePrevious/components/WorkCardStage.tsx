import * as React from 'react';
import { View } from 'react-native';
import { t } from '@/text';
import { wqStage } from '../model/wqCardData';
import { useDeskPaint } from '../palette';
import { DeskText as Text } from '../typography/DeskText';

/** Mockup 12's compact pips. wq has no evidence for landing on Review. */
export function WorkCardStage({ issueKey, status }: { issueKey: string; status: string }) {
    const { paint } = useDeskPaint();
    const stage = wqStage(status);
    if (!stage) return null;
    const label = t(`ignorePrevious.workCard.${stage}`);
    if (stage === 'blocked' || stage === 'needsYou') {
        return <Text style={{ color: paint.mute, fontSize: 12 }}>{label}</Text>;
    }
    const index = { plan: 0, build: 1, pr: 3, merged: 4 }[stage];
    return (
        <View testID={`ip-work-stage-${issueKey}`} accessible accessibilityLabel={t('ignorePrevious.workCard.stage', { stage: label })} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            {[0, 1, 2, 3, 4].map(i => (
                <View key={i} accessible={false} style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: i <= index ? paint.ink : paint.rule }} />
            ))}
            <Text style={{ color: paint.mute, fontSize: 12 }}>{label}</Text>
        </View>
    );
}
