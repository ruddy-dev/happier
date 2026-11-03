import * as React from 'react';
import { Pressable, View } from 'react-native';
import { SESSION_USAGE_LIMIT_RECOVERY_METADATA_KEY } from '@happier-dev/protocol';
import { readSessionAppliedModelMetadataStateV1 } from '@happier-dev/agents';
import { resolveAgentIdFromFlavor } from '@/agents/catalog/catalog';
import { matchesSessionControlProvider } from '@/sync/domains/sessionControl/readSessionControlMetadata';
import { getModelOverrideForSpawn } from '@/sync/domains/models/modelOverride';
import { resolveMetadataModelOverride } from '@/sync/domains/sessionAuthoring/sessionAuthoringNormalization';
import { storage } from '@/sync/domains/state/storage';
import { useShallow } from 'zustand/react/shallow';

import type { SessionListRenderableSession } from '@/sync/domains/session/listing/sessionListRenderable';
import type { Session } from '@/sync/domains/state/storageTypes';
import { t } from '@/text';
import { getSessionName, getSessionStatus } from '@/utils/sessions/sessionUtils';

import { DeskText as Text } from '../typography/DeskText';
import { bulbFromSessionState, type Bulb } from '../model/bulb';
import { groupWorkersByIssue, type WorkerRow } from '../model/groupWorkers';
import { useCoordinatorId } from '../model/useCoordinatorId';
import { workerLastActivityAt, workerUnheardMinutes } from '../model/workerFreshness';
import { isDeskWorkerBusy } from '../model/workerBusy';
import { workerUsageLimit } from '../model/workerUsageLimit';
import { deriveIssueArchive } from '../model/issueArchive';
import { buildWorkerPrBadge } from '../model/workerPrBadge';
import { useDeskNow } from '../model/useDeskNow';
import { useWorkCardData } from '../model/useWorkCardData';
import { bulbColour, useDeskPaint } from '../palette';
import { sessionContextMeter } from './ContextMeter';
import { BulbLabel, bulbWord } from './BulbLabel';
import { IssueCard } from './IssueCard';
import { useDeskSessions } from '../useDeskSessions';
import { spriteForModel } from '../sprites';
import { WorkerSprite, type WorkerSpriteProps } from './WorkerSprite';

export function toWorkerRows(
    list: readonly SessionListRenderableSession[],
    lookup: ReadonlyMap<string, Session>,
    issueKeys: ReadonlyMap<string, string | null>,
    nowMs: number,
): WorkerRow[] {
    return list.map((row) => {
        // Mode and context size live on the full record, so they show once it has loaded.
        const loaded = lookup.get(row.id);
        const applied = loaded ? readSessionAppliedModelMetadataStateV1(loaded.metadata) : null;
        const agentId = resolveAgentIdFromFlavor(loaded?.metadata?.flavor);
        const appliedModel = applied && agentId && matchesSessionControlProvider({ agentId, metadata: loaded?.metadata, provider: applied.provider })
            ? applied.modelId : null;
        const meter = loaded ? sessionContextMeter(loaded) : null;
        // Freshness is judged against the desk clock, so a worker that falls silent goes stale without a store write.
        const state = getSessionStatus(row, nowMs).state;
        const unheardMinutes = workerUnheardMinutes(row, nowMs);
        const usageLimit = workerUsageLimit(row, loaded ? loaded.metadata?.[SESSION_USAGE_LIMIT_RECOVERY_METADATA_KEY] ?? null : undefined);
        return {
            sessionId: row.id,
            title: getSessionName(row),
            // Resolved once per worker from its tag, title, branch and folder (see resolveIssue).
            issueKey: issueKeys.get(row.id) ?? null,
            model: loaded ? appliedModel ?? getModelOverrideForSpawn(loaded)?.modelId
                ?? resolveMetadataModelOverride(loaded).modelId ?? loaded.modelMode ?? null : null,
            bulb: bulbFromSessionState(state, usageLimit !== null),
            usageLimit,
            permissionMode: loaded ? (loaded.permissionMode ?? 'default') : null,
            updatedAt: row.updatedAt,
            lastActivityAt: workerLastActivityAt(row),
            contextPercent: meter ? meter.percent : null,
            canStop: isDeskWorkerBusy(state) && unheardMinutes === null,
            unheardMinutes,
            inactive: row.active !== true,
        };
    });
}

const COUNTED: readonly Bulb[] = ['turn', 'stuck', 'working', 'waiting', 'idle'];

/** How many agents are in each state, as plain numbers, so nobody has to count bulbs. */
function WorkCounts({ rows, ready }: { rows: readonly WorkerRow[]; ready: boolean }) {
    const { text, colours } = useDeskPaint();
    const counts: Record<Bulb, number> = { turn: 0, stuck: 0, working: 0, waiting: 0, idle: 0 };
    for (const row of rows) counts[row.bulb] += 1;

    const tile = (id: string, value: number, label: string, dot: string | null) => (
        <View key={id} style={{ minWidth: 64, gap: 2 }}>
            <Text
                testID={`ip-count-${id}`}
                style={{ color: text.primary, fontSize: 22, fontWeight: '600' }}
            >
                {/* Before the first sync a 0 would be a false count, so each tile shows a dash. */}
                {ready ? value : '–'}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                {dot ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: dot }} /> : null}
                <Text style={{ color: text.secondary, fontSize: 12 }}>{label}</Text>
            </View>
        </View>
    );

    return (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 16 }}>
            {tile('all', rows.length, t('ignorePrevious.countAll'), null)}
            {COUNTED.map((bulb) => tile(bulb, counts[bulb], bulbWord(bulb), bulbColour(colours, bulb)))}
        </View>
    );
}

/**
 * Every unarchived session grouped by the issue it works on. Faces shows folded cards you open one
 * at a time; Details opens them all. `compact` draws just each issue's key and state, in a column
 * (the desk's collapsed rail) or a row (its narrow-screen strip).
 */
export function WorkColumn({ compact, faceStyle, calm }: { compact?: 'column' | 'row'; faceStyle?: WorkerSpriteProps['faceStyle']; calm?: boolean }) {
    const { text, inset, colours } = useDeskPaint();
    const desk = useDeskSessions();
    const { lookup, ready } = desk;
    // The coordinator is the chat beside this panel, not a worker: it gets no row, tile or card (L1).
    const coordinatorId = useCoordinatorId(desk.list);
    const live = React.useMemo(
        () => (coordinatorId ? desk.list.filter((row) => row.id !== coordinatorId) : desk.list),
        [desk.list, coordinatorId],
    );
    const allWorkers = React.useMemo(() => [...live, ...desk.archived, ...desk.unreadable]
        .filter(row => row.id !== coordinatorId), [live, desk.archived, desk.unreadable, coordinatorId]);
    const workers = React.useMemo(() => ({ ...desk, list: allWorkers }), [desk, allWorkers]);
    const [details, setDetails] = React.useState(false);
    const [openKeys, setOpenKeys] = React.useState<ReadonlySet<string>>(() => new Set());

    const nowMs = useDeskNow();
    const workData = useWorkCardData(coordinatorId, workers, nowMs);
    const { issueKeys } = workData;
    // One store-only projection. A merge observed while cards are folded still updates admission.
    const prStates = storage(useShallow(state => Object.fromEntries(allWorkers.map(row => [row.id,
        buildWorkerPrBadge(state.getSessionProjectScmSnapshot(row.id), nowMs)?.state ?? null,
    ]))));
    const archiveStates = React.useMemo(() => {
        const byIssue = new Map<string, SessionListRenderableSession[]>();
        for (const row of allWorkers) {
            const key = issueKeys.get(row.id);
            if (!key) continue;
            const rows = byIssue.get(key);
            if (rows) rows.push(row);
            else byIssue.set(key, [row]);
        }
        return new Map([...byIssue].map(([key, sessions]) => [key, deriveIssueArchive(key, sessions, prStates, coordinatorId, nowMs)]));
    }, [allWorkers, issueKeys, prStates, coordinatorId, nowMs]);
    // Rows rebuild when the list, a full record, an issue key or the desk clock changes; nothing else.
    const rows = React.useMemo(() => toWorkerRows(live, lookup, issueKeys, nowMs), [live, lookup, issueKeys, nowMs]);
    const groups = React.useMemo(() => groupWorkersByIssue(rows), [rows]);

    const toggle = React.useCallback((key: string) => {
        setOpenKeys((prev) => {
            const next = new Set(prev);
            if (!next.delete(key)) next.add(key);
            return next;
        });
    }, []);

    const modeButton = (label: string, active: boolean, onPress: () => void) => (
        <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={onPress}
            style={{
                paddingHorizontal: 10,
                paddingVertical: 4,
                borderRadius: 8,
                backgroundColor: active ? inset : 'transparent',
            }}
        >
            <Text style={{ color: active ? text.primary : text.secondary, fontSize: 13 }}>{label}</Text>
        </Pressable>
    );

    if (compact) {
        return (
            <View style={{ flexDirection: compact, flexWrap: compact === 'row' ? 'wrap' : 'nowrap', alignItems: 'center', minWidth: 0, maxWidth: '100%', gap: 4 }}>
                {groups.map((group) => {
                    const label = group.issueKey ?? t('ignorePrevious.noIssue');
                    return (
                        <View
                            key={group.issueKey ?? 'no-issue'}
                            testID={`ip-rail-issue-${group.issueKey ?? 'none'}`}
                            accessible
                            accessibilityLabel={t('ignorePrevious.workList.railLabel', { key: label, state: bulbWord(group.bulb), count: t('ignorePrevious.workList.workerCount', { count: group.workers.length }) })}
                            style={{ width: 62, maxWidth: '100%', minWidth: 0, alignItems: 'center', gap: 1, paddingHorizontal: 2, paddingTop: 4, paddingBottom: 5, borderRadius: 10 }}
                        >
                            {group.bulb === 'turn' ? (
                                <View pointerEvents="none" accessible={false} style={{ position: 'absolute', left: 0, top: 8, bottom: 8, width: 3, borderRadius: 3, backgroundColor: bulbColour(colours, group.bulb) }} />
                            ) : null}
                            <View testID={`ip-rail-face-${group.issueKey ?? 'none'}`} accessible={false} style={{ width: 28, height: 28, flexShrink: 0 }}>
                                <WorkerSprite kind={spriteForModel(group.stateWorker?.model)} bulb={group.bulb} size={28} faceStyle={faceStyle} calm={calm} />
                            </View>
                            <Text style={{ color: text.primary, fontSize: 11, fontWeight: '600', maxWidth: '100%' }} numberOfLines={1} ellipsizeMode="tail">
                                {label}
                            </Text>
                            <BulbLabel bulb={group.bulb} size={8} />
                            <Text accessibilityLabel={t('ignorePrevious.workList.workerCount', { count: group.workers.length })} style={{ color: text.secondary, fontSize: 11 }}>{group.workers.length}</Text>
                        </View>
                    );
                })}
            </View>
        );
    }

    return (
        <View style={{ gap: 10, minWidth: 0, maxWidth: '100%' }}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
                <Text style={{ color: text.primary, fontSize: 18, fontWeight: '600' }}>
                    {t('ignorePrevious.work')}
                </Text>
                <View style={{ flexDirection: 'row', marginLeft: 'auto', gap: 4 }}>
                    {modeButton(t('ignorePrevious.faces'), !details, () => setDetails(false))}
                    {modeButton(t('ignorePrevious.details'), details, () => setDetails(true))}
                </View>
            </View>
            <WorkCounts rows={rows} ready={ready} />
            <View style={{ gap: 8, minWidth: 0, width: '100%' }}>
                {groups.map((group) => {
                    const key = group.issueKey ?? '';
                    return (
                        <IssueCard
                            key={key || 'no-issue'}
                            group={group}
                            item={key ? workData.items.get(key) : null}
                            projectName={key ? workData.projectNames?.get(key.split('-')[0]) : undefined}
                            archive={archiveStates.get(key)}
                            knownProjectCodes={workData.knownProjectCodes}
                            open={details || openKeys.has(key)}
                            onToggle={() => toggle(key)}
                            faceStyle={faceStyle}
                            calm={calm}
                        />
                    );
                })}
            </View>
        </View>
    );
}
