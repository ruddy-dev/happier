import * as React from 'react';
import { Pressable, View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';

import { Text } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';
import { useNavigateToSession } from '@/hooks/session/useNavigateToSession';
import { t } from '@/text';

import type { IssueGroup } from '../model/groupWorkers';
import { bulbColour, useIpColours } from '../palette';
import { MaskFace } from './MaskFace';

export type IssueCardProps = Readonly<{
    group: IssueGroup;
    open: boolean;
    onToggle: () => void;
}>;

/**
 * One issue in the Work column. Folded, it is a mask face whose bulb shows the most urgent worker,
 * with the issue key and the newest worker's title. Open, it lists every worker on that issue.
 */
export const IssueCard = React.memo(function IssueCard({ group, open, onToggle }: IssueCardProps) {
    const { theme } = useUnistyles();
    const colours = useIpColours();
    const navigateToSession = useNavigateToSession();
    const label = group.issueKey ?? t('ignorePrevious.noIssue');
    const newest = group.workers[0];
    const secondary = { color: theme.colors.text.secondary, fontSize: 13 };

    return (
        <View
            style={{
                gap: 8,
                padding: 12,
                borderRadius: 12,
                backgroundColor: theme.colors.surface.elevated,
                minWidth: 150,
                flexGrow: open ? 1 : 0,
                flexBasis: open ? '100%' : 'auto',
            }}
        >
            <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: open }}
                onPress={onToggle}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}
            >
                <MaskFace size={40} bulb={group.bulb} sleepy={group.bulb !== 'turn'} />
                <View style={{ flexShrink: 1, gap: 2 }}>
                    <Text style={{ color: theme.colors.text.primary, fontSize: 15, ...Typography.default('semiBold') }}>
                        {label}
                    </Text>
                    {open || !newest ? null : (
                        <Text style={secondary} numberOfLines={1}>
                            {newest.title}
                        </Text>
                    )}
                </View>
            </Pressable>
            {open
                ? group.workers.map((worker) => (
                      <View key={worker.sessionId} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                          <View
                              style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: bulbColour(colours, worker.bulb) }}
                          />
                          <Text style={{ color: theme.colors.text.primary, fontSize: 14, flexShrink: 1 }} numberOfLines={1}>
                              {worker.title}
                          </Text>
                          <Text
                              style={{
                                  ...secondary,
                                  ...Typography.mono(),
                                  paddingHorizontal: 6,
                                  paddingVertical: 2,
                                  borderRadius: 6,
                                  backgroundColor: theme.colors.surface.inset,
                              }}
                          >
                              {worker.permissionMode}
                          </Text>
                          <Pressable
                              testID={`ip-open-worker-${worker.sessionId}`}
                              accessibilityRole="button"
                              accessibilityLabel={t('ignorePrevious.openWorker')}
                              onPress={() => void navigateToSession(worker.sessionId)}
                              style={{
                                  marginLeft: 'auto',
                                  paddingHorizontal: 8,
                                  paddingVertical: 4,
                                  borderRadius: 8,
                                  borderWidth: 1,
                                  borderColor: theme.colors.border.default,
                              }}
                          >
                              <Text style={{ color: theme.colors.text.primary, fontSize: 13, ...Typography.mono() }}>{'>_'}</Text>
                          </Pressable>
                      </View>
                  ))
                : null}
        </View>
    );
});
