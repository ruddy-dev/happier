import * as React from 'react';
import { Pressable, View } from 'react-native';

import { useDeskSessionNavigation } from '../useDeskSessionNavigation';
import { t } from '@/text';

import { DeskText as Text } from '../typography/DeskText';
import type { IssueGroup } from '../model/groupWorkers';
import { bulbColour, useDeskPaint } from '../palette';
import { BulbLabel, bulbWord } from './BulbLabel';
import { WorkerActions } from './WorkerActions';
import { WorkerUsageLimitLine, WorkerUsageLimitSummary } from './WorkerUsageLimitLine';
import { WorkerPrBadge } from './WorkerPrBadge';
import { WorkerSprite, type WorkerSpriteProps } from './WorkerSprite';
import { spriteForModel } from '../sprites';
import { wqStage, type WqItem } from '../model/wqCardData';
import { WorkCardStage } from './WorkCardStage';
import { IssueArchiveAction } from './IssueArchiveAction';
import type { IssueArchiveState } from '../model/issueArchive';
import { useDeskPref } from '../deskPrefs';

export type IssueCardProps = Readonly<{
    group: IssueGroup;
    open: boolean;
    onToggle: () => void;
    faceStyle?: WorkerSpriteProps['faceStyle'];
    calm?: boolean;
    item?: WqItem | null;
    projectName?: string;
    attention?: string;
    archive?: IssueArchiveState;
    knownProjectCodes?: ReadonlySet<string>;
}>;

/**
 * The issue title and the state-owning worker's attention reason lead; project and key are context.
 * Open, it lists every worker on that issue.
 */
export const IssueCard = React.memo(function IssueCard({ group, open, onToggle, faceStyle, calm, item, projectName, attention, archive, knownProjectCodes }: IssueCardProps) {
    const { paint, borderWidth, colours } = useDeskPaint();
    const [chatStyle] = useDeskPref('chatStyle');
    const terminal = chatStyle === 'terminal';
    const navigateToSession = useDeskSessionNavigation();
    const label = group.issueKey ?? t('ignorePrevious.noIssue');
    const newest = group.workers[0];
    const stateWorker = group.stateWorker;
    const freshnessWorker = stateWorker ?? newest;
    const unheardMinutes = freshnessWorker?.unheardMinutes;
    const limitedWorkers = open ? [] : group.workers.filter(worker => worker.usageLimit);
    const titleCounts = new Map<string, number>();
    if (open) for (const worker of group.workers) titleCounts.set(worker.title, (titleCounts.get(worker.title) ?? 0) + 1);
    const count = t('ignorePrevious.workList.workerCount', { count: group.workers.length });
    const secondary = { color: paint.mute, fontSize: 13 };
    const stage = item ? wqStage(item.status) : null;
    const contextProject = item ? projectName : undefined;
    const title = item?.title ?? newest?.title ?? label;
    const summary = [contextProject, title !== label ? label : null, stage ? t('ignorePrevious.workCard.stage', { stage: t(`ignorePrevious.workCard.${stage}`) }) : null].filter(Boolean).join('. ');

    return (
        <View
            testID={`ip-issue-${group.issueKey ?? 'none'}`}
            style={{
                borderRadius: terminal ? 0 : 10,
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
                accessibilityLabel={t('ignorePrevious.workList.cardLabel', { key: title, state: attention ?? bulbWord(group.bulb), count, summary, unheard: unheardMinutes != null ? t('ignorePrevious.connection.unheard', { minutes: unheardMinutes }) : '' })}
                onPress={onToggle}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 8, paddingLeft: 12, paddingRight: 8, minWidth: 0, borderRadius: terminal ? 0 : 8 }}
            >
                <View testID={`ip-work-card-face-${group.issueKey ?? 'none'}`} accessible={false} style={{ width: 40, height: 40, flexShrink: 0 }}>
                    <WorkerSprite kind={spriteForModel(group.stateWorker?.model)} bulb={group.bulb} size={40} faceStyle={faceStyle} calm={calm} />
                </View>
                <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                    <Text numberOfLines={2} ellipsizeMode="tail" style={{ color: paint.ink, fontSize: 14, fontWeight: '600' }}>
                        {title}
                    </Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 7 }}>
                        <BulbLabel bulb={group.bulb} />
                        {attention ? <Text style={{ color: paint.ink, fontSize: 13, flexShrink: 1 }} numberOfLines={2} ellipsizeMode="tail">{attention}</Text> : null}
                        {open ? <Text testID={`ip-work-worker-count-${group.issueKey ?? 'none'}`} style={secondary}>{count}</Text> : null}
                    </View>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 7 }}>
                        <Text testID={`ip-work-context-${group.issueKey ?? 'none'}`} style={{ color: paint.mute, fontSize: 11 }}>{[contextProject, label].filter(Boolean).join(' · ')}</Text>
                        {item ? <WorkCardStage issueKey={item.id} status={item.status} /> : null}
                    </View>
                    {!open && unheardMinutes != null ? (
                        <Text testID={`ip-worker-stale-${freshnessWorker?.sessionId}`} style={secondary}>
                            {t('ignorePrevious.connection.unheard', { minutes: unheardMinutes })}
                        </Text>
                    ) : null}
                </View>
            </Pressable>
            {limitedWorkers.length > 0 ? (
                <View style={{ paddingHorizontal: 12, paddingBottom: 8, minWidth: 0, maxWidth: '100%' }}>
                    {limitedWorkers.length === 1 && limitedWorkers[0].usageLimit ? (
                        <WorkerUsageLimitLine status={limitedWorkers[0].usageLimit} sessionId={limitedWorkers[0].sessionId} compact />
                    ) : (
                        <WorkerUsageLimitSummary statuses={limitedWorkers.flatMap(worker => worker.usageLimit ? [worker.usageLimit] : [])} issueKey={group.issueKey ?? 'none'} />
                    )}
                </View>
            ) : null}
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
                          {(titleCounts.get(worker.title) ?? 0) > 1 ? (
                              <Text testID={`ip-worker-session-${worker.sessionId}`} style={secondary}>
                                  {t('ignorePrevious.usageLimit.workerSession', { id: worker.sessionId })}
                              </Text>
                          ) : null}
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
            {open && group.issueKey && archive ? <IssueArchiveAction issueKey={group.issueKey} model={archive} workers={group.workers} knownProjectCodes={knownProjectCodes} /> : null}
        </View>
    );
});
