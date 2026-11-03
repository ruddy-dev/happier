import * as React from 'react';
import { Pressable, View } from 'react-native';

import { useDeskSessionNavigation } from '../useDeskSessionNavigation';
import { t } from '@/text';

import { DeskText as Text } from '../typography/DeskText';
import type { IssueGroup } from '../model/groupWorkers';
import { bulbColour, useDeskPaint } from '../palette';
import { BulbLabel, bulbWord } from './BulbLabel';
import { WorkerActions } from './WorkerActions';
import { WorkerUsageLimitLine } from './WorkerUsageLimitLine';
import { WorkerPrBadge } from './WorkerPrBadge';
import { WorkerSprite, type WorkerSpriteProps } from './WorkerSprite';
import { spriteForModel } from '../sprites';
import { wqStage, type WqItem } from '../model/wqCardData';
import { WorkCardStage } from './WorkCardStage';

export type IssueCardProps = Readonly<{
    group: IssueGroup;
    open: boolean;
    onToggle: () => void;
    faceStyle?: WorkerSpriteProps['faceStyle'];
    calm?: boolean;
    item?: WqItem | null;
    projectName?: string;
}>;

/**
 * One issue in the Work column. Folded, it shows the issue key, the most urgent worker's state as a
 * bulb dot and word, and the newest worker's title. Open, it lists every worker on that issue.
 */
export const IssueCard = React.memo(function IssueCard({ group, open, onToggle, faceStyle, calm, item, projectName }: IssueCardProps) {
    const { paint, borderWidth, colours } = useDeskPaint();
    const navigateToSession = useDeskSessionNavigation();
    const label = group.issueKey ?? t('ignorePrevious.noIssue');
    const newest = group.workers[0];
    const count = t('ignorePrevious.workList.workerCount', { count: group.workers.length });
    const secondary = { color: paint.mute, fontSize: 13 };
    const stage = item ? wqStage(item.status) : null;
    const summary = item ? [projectName, item.title, stage ? t('ignorePrevious.workCard.stage', { stage: t(`ignorePrevious.workCard.${stage}`) }) : null].filter(Boolean).join('. ') : newest?.title ?? '';

    return (
        <View
            testID={`ip-issue-${group.issueKey ?? 'none'}`}
            style={{
                borderRadius: 13,
                borderWidth,
                borderColor: group.bulb === 'stuck' ? bulbColour(colours, group.bulb) : paint.rule,
                backgroundColor: paint.panel2,
                minWidth: 0,
                maxWidth: '100%',
                width: '100%',
            }}
        >
            {group.bulb === 'turn' ? (
                <View pointerEvents="none" accessible={false} style={{ position: 'absolute', left: 0, top: 8, bottom: 8, width: 5, borderRadius: 3, backgroundColor: bulbColour(colours, group.bulb) }} />
            ) : null}
            <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: open }}
                accessibilityLabel={t('ignorePrevious.workList.cardLabel', { key: label, state: bulbWord(group.bulb), count, summary, unheard: newest?.unheardMinutes != null ? t('ignorePrevious.connection.unheard', { minutes: newest.unheardMinutes }) : '' })}
                onPress={onToggle}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 8, paddingLeft: 12, paddingRight: 6, minWidth: 0, borderRadius: 11 }}
            >
                <View testID={`ip-work-card-face-${group.issueKey ?? 'none'}`} accessible={false} style={{ width: 40, height: 40, flexShrink: 0 }}>
                    <WorkerSprite kind={spriteForModel(group.stateWorker?.model)} bulb={group.bulb} size={40} faceStyle={faceStyle} calm={calm} />
                </View>
                <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                    <Text numberOfLines={1} ellipsizeMode="tail" style={{ color: paint.ink, fontSize: 15, fontWeight: '600' }}>
                        {label}
                    </Text>
                    {item ? <>
                        <Text numberOfLines={1} ellipsizeMode="tail" style={secondary}>{projectName}</Text>
                        <Text numberOfLines={1} ellipsizeMode="tail" style={{ color: paint.ink, fontSize: 14 }}>{item.title}</Text>
                        <WorkCardStage issueKey={item.id} status={item.status} />
                    </> : null}
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 7 }}>
                        <BulbLabel bulb={group.bulb} />
                        <Text testID={`ip-work-worker-count-${group.issueKey ?? 'none'}`} style={secondary}>{count}</Text>
                    </View>
                    {open || !newest ? null : (
                        <Text style={secondary} numberOfLines={1} ellipsizeMode="tail">
                            {newest.title}
                        </Text>
                    )}
                    {!open && newest?.unheardMinutes != null ? (
                        <Text testID={`ip-worker-stale-${newest.sessionId}`} style={secondary}>
                            {t('ignorePrevious.connection.unheard', { minutes: newest.unheardMinutes })}
                        </Text>
                    ) : null}
                </View>
            </Pressable>
            {open
                ? group.workers.map((worker) => (
                      <View key={worker.sessionId} style={{ minWidth: 0, gap: 4, paddingHorizontal: 12, paddingVertical: 8, borderTopWidth: 1, borderTopColor: paint.rule }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                              <View testID={`ip-worker-face-${worker.sessionId}`}>
                                  <WorkerSprite kind={spriteForModel(worker.model)} bulb={worker.bulb} size={24} faceStyle={faceStyle} calm={calm} />
                              </View>
                              <Text style={{ color: paint.ink, fontSize: 14, flex: 1, minWidth: 0 }} numberOfLines={1} ellipsizeMode="tail">
                                  {worker.title}
                              </Text>
                              {typeof worker.contextPercent === 'number' ? (
                                  <Text testID={`ip-worker-context-${worker.sessionId}`} style={secondary}>
                                      {worker.contextPercent}%
                                  </Text>
                              ) : null}
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
                                      borderColor: paint.rule,
                                  }}
                              >
                                  <Text style={{ color: paint.ink, fontSize: 13 }}>{'>_'}</Text>
                              </Pressable>
                          </View>
                          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
                              <BulbLabel bulb={worker.bulb} />
                              <View style={{ marginLeft: 'auto' }}><WorkerPrBadge sessionId={worker.sessionId} /></View>
                          </View>
                          {worker.usageLimit ? <WorkerUsageLimitLine status={worker.usageLimit} sessionId={worker.sessionId} /> : null}
                          {worker.unheardMinutes != null ? (
                              <Text testID={`ip-worker-stale-${worker.sessionId}`} style={secondary}>
                                  {t('ignorePrevious.connection.unheard', { minutes: worker.unheardMinutes })}
                              </Text>
                          ) : null}
                          {/* On their own line so the title keeps the row's width in a narrow column. */}
                          <WorkerActions worker={worker} />
                      </View>
                  ))
                : null}
        </View>
    );
});
