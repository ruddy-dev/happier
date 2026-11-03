import * as React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { SESSION_USAGE_LIMIT_RECOVERY_METADATA_KEY } from '@happier-dev/protocol';
import { readSessionAppliedModelMetadataStateV1, resolveAgentIdFromSessionMetadata } from '@happier-dev/agents';
import { matchesSessionControlProvider } from '@/sync/domains/sessionControl/readSessionControlMetadata';
import { getModelOverrideForSpawn } from '@/sync/domains/models/modelOverride';
import { resolveMetadataModelOverride } from '@/sync/domains/sessionAuthoring/sessionAuthoringNormalization';
import { storage } from '@/sync/domains/state/storage';
import { useShallow } from 'zustand/react/shallow';

import type { SessionListRenderableSession } from '@/sync/domains/session/listing/sessionListRenderable';
import type { Session } from '@/sync/domains/state/storageTypes';
import { t } from '@/text';
import { useScrollEdgeFades } from '@/components/ui/scroll/useScrollEdgeFades';
import { getSessionName, getSessionStatus } from '@/utils/sessions/sessionUtils';

import { DeskText as Text } from '../typography/DeskText';
import { bulbFromSessionState, type Bulb } from '../model/bulb';
import { groupWorkersByIssue, type WorkerRow } from '../model/groupWorkers';
import { useCoordinatorId } from '../model/useCoordinatorId';
import { workerLastActivityAt, workerUnheardMinutes } from '../model/workerFreshness';
import { isDeskWorkerBusy } from '../model/workerBusy';
import { workerUsageLimit } from '../model/workerUsageLimit';
import { buildWorkerArchivePrState, deriveIssueArchive } from '../model/issueArchive';
import { useDeskNow } from '../model/useDeskNow';
import { useWorkCardData } from '../model/useWorkCardData';
import { waitingRestrictionLabel } from './waitingRestrictionLabel';
import { approvalDisabledReason, useDeskWaits } from '../model/useDeskWaits';
import { bulbColour, useDeskPaint } from '../palette';
import { sessionContextMeter } from './ContextMeter';
import { BulbLabel, bulbWord } from './BulbLabel';
import { IssueCard } from './IssueCard';
import { useDeskSessions } from '../useDeskSessions';
import { spriteForModel } from '../sprites';
import { WorkerSprite, type WorkerSpriteProps } from './WorkerSprite';
import { WorkAppearance } from './WorkAppearance';
import { useDeskPref } from '../deskPrefs';
import { DeskFixtureRouteContext } from '../deskFixtureGate';

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
        const agentId = resolveAgentIdFromSessionMetadata(loaded?.metadata ?? row.metadata);
        const appliedModel = applied && agentId && matchesSessionControlProvider({ agentId, metadata: loaded?.metadata, provider: applied.provider })
            ? applied.modelId : null;
        const meter = loaded ? sessionContextMeter(loaded) : null;
        // Freshness is judged against the desk clock, so a worker that falls silent goes stale without a store write.
        const state = getSessionStatus(row, nowMs).state;
        // Rights are on the list row, including before hydration and after a grant refresh.
        // Keep runtime freshness authoritative: only a current prompt is reclassified.
        const disabledReason = state === 'permission_required' || state === 'action_required'
            ? approvalDisabledReason(row) : null;
        const unheardMinutes = workerUnheardMinutes(row, nowMs);
        const usageLimit = workerUsageLimit(row, loaded ? loaded.metadata?.[SESSION_USAGE_LIMIT_RECOVERY_METADATA_KEY] ?? null : undefined);
        return {
            sessionId: row.id,
            title: getSessionName(row),
            // Resolved once per worker from its tag, title, branch and folder (see resolveIssue).
            issueKey: issueKeys.get(row.id) ?? null,
            model: loaded ? appliedModel ?? getModelOverrideForSpawn(loaded)?.modelId
                ?? resolveMetadataModelOverride(loaded).modelId ?? loaded.modelMode ?? null : null,
            agentId,
            bulb: disabledReason ? 'waiting' : bulbFromSessionState(state, usageLimit !== null),
            approvalDisabledReason: disabledReason,
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

/** How many workers are in each state, as plain numbers, so nobody has to count bulbs. */
function WorkCounts({ rows, ready }: { rows: readonly WorkerRow[]; ready: boolean }) {
    const { text } = useDeskPaint();
    const scrollRef = React.useRef<ScrollView>(null);
    const viewport = React.useRef({ width: 0, x: 0 });
    const [availableWidth, setAvailableWidth] = React.useState(0);
    const [contentWidth, setContentWidth] = React.useState(0);
    const edges = useScrollEdgeFades({ enabledEdges: { left: true, right: true } });
    // Measure against the whole line, so removing the controls on resize cannot trap them onscreen.
    const overflow = availableWidth > 0 && contentWidth > availableWidth + 1;
    const counts: Record<Bulb, number> = { turn: 0, stuck: 0, working: 0, waiting: 0, idle: 0 };
    for (const row of rows) counts[row.bulb] += 1;

    const entries = [{ id: 'all', value: rows.length, label: t('ignorePrevious.workList.counts.all'), short: t('ignorePrevious.workList.counts.all') },
        ...COUNTED.map(bulb => ({ id: bulb, value: counts[bulb], label: bulbWord(bulb), short: t(`ignorePrevious.workList.counts.${bulb}`) }))];

    const countLabel = ({ id, value, label }: typeof entries[number]) => `${label}: ${ready
        ? id === 'all' ? value : t('ignorePrevious.workList.workerCount', { count: value })
        : t('ignorePrevious.connecting')}`;

    const page = (direction: -1 | 1) => scrollRef.current?.scrollTo({
        x: Math.max(0, viewport.current.x + direction * viewport.current.width), animated: false,
    });
    const control = (direction: 'previous' | 'next', disabled: boolean) => (
        <Pressable
            testID={`ip-work-counts-${direction}`}
            accessibilityRole="button"
            accessibilityLabel={t(`ignorePrevious.workList.counts.${direction}`)}
            accessibilityState={{ disabled }}
            disabled={disabled}
            onPress={() => page(direction === 'previous' ? -1 : 1)}
            style={{ minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.4 : 1 }}
        >
            <Text accessible={false} style={{ color: text.secondary, fontSize: 16 }}>{direction === 'previous' ? '‹' : '›'}</Text>
        </Pressable>
    );

    return (
        <View
            testID="ip-work-counts-frame"
            onLayout={event => setAvailableWidth(event.nativeEvent.layout.width)}
            style={{ flexDirection: 'row', alignItems: 'center', minWidth: 0, maxWidth: '100%' }}
        >
            {overflow ? control('previous', !edges.visibility.left) : null}
            <ScrollView
                ref={scrollRef}
                testID="ip-work-counts"
                horizontal
                focusable
                accessibilityLabel={entries.map(countLabel).join('. ')}
                onLayout={event => {
                    viewport.current.width = event.nativeEvent.layout.width;
                    edges.onViewportLayout(event);
                }}
                onContentSizeChange={(width, height) => {
                    setContentWidth(width);
                    edges.onContentSizeChange(width, height);
                }}
                onScroll={event => {
                    viewport.current.x = event.nativeEvent.contentOffset.x;
                    edges.onScroll(event);
                }}
                onMomentumScrollEnd={event => {
                    viewport.current.x = event.nativeEvent.contentOffset.x;
                    edges.onMomentumScrollEnd(event);
                }}
                scrollEventThrottle={16}
                style={{ minWidth: 0, flex: 1 }}
                contentContainerStyle={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingBottom: 4 }}
            >
                {entries.map(({ id, value, label, short }) => (
                    <Text key={id} accessibilityLabel={countLabel({ id, value, label, short })} numberOfLines={1} style={{ color: text.secondary, fontSize: 12, flexShrink: 0 }}>
                        {short}{' '}<Text testID={`ip-count-${id}`} style={{ fontWeight: '600' }}>{ready ? value : '–'}</Text>
                    </Text>
                ))}
            </ScrollView>
            {overflow ? control('next', !edges.visibility.right) : null}
        </View>
    );
}

/**
 * Every unarchived session grouped by the issue it works on. Faces shows folded cards you open one
 * at a time; Details opens them all. `compact` draws just each issue's key and state, in a column
 * (the desk's collapsed rail) or a row (its narrow-screen strip).
 */
type WorkColumnProps = { compact?: 'column' | 'row'; faceStyle?: WorkerSpriteProps['faceStyle']; calm?: boolean };

export function WorkColumn(props: WorkColumnProps) {
    return <WorkAppearance><WorkColumnContent {...props} /></WorkAppearance>;
}

/** Only the expanded Work layout consumes request labels and attention details. */
function WorkDetailProjection({ excludeSessionId, children }: {
    excludeSessionId?: string;
    children: (attentionBySession: ReadonlyMap<string, string>) => React.ReactNode;
}) {
    const waits = useDeskWaits(excludeSessionId);
    const attentionBySession = React.useMemo(() => {
        const reasons = new Map<string, string>();
        for (const wait of waits.items) {
            if (!reasons.has(wait.sessionId)) reasons.set(wait.sessionId, wait.kind === 'user_action'
                ? t('ignorePrevious.question')
                : t('ignorePrevious.workList.approvalNeeded', { summary: wait.summary }));
        }
        return reasons;
    }, [waits.items]);

    return children(attentionBySession);
}

function WorkColumnContent({ compact, faceStyle, calm }: WorkColumnProps) {
    const { paint, text, inset, colours } = useDeskPaint();
    const [style] = useDeskPref('chatStyle');
    const terminal = style === 'terminal';
    const fixture = React.useContext(DeskFixtureRouteContext);
    const desk = useDeskSessions();
    const { lookup, ready } = desk;
    // The coordinator is the chat beside this panel, not a worker: it gets no row, tile or card (L1).
    const coordinatorId = useCoordinatorId(desk.list);
    const live = React.useMemo(
        () => (coordinatorId ? desk.list.filter((row) => row.id !== coordinatorId) : desk.list),
        [desk.list, coordinatorId],
    );
    const allWorkers = React.useMemo(() => [...live, ...desk.unreadable]
        .filter(row => row.id !== coordinatorId), [live, desk.unreadable, coordinatorId]);
    const workers = React.useMemo(() => ({ ...desk, list: allWorkers }), [desk, allWorkers]);
    const [details, setDetails] = React.useState(false);
    const [openKeys, setOpenKeys] = React.useState<ReadonlySet<string>>(() => new Set());

    const nowMs = useDeskNow();
    const workData = useWorkCardData(coordinatorId, workers, nowMs);
    const { issueKeys } = workData;
    // One store-only projection. A merge observed while cards are folded still updates admission.
    const prStates = storage(useShallow(state => Object.fromEntries(allWorkers.map(row => [row.id,
        buildWorkerArchivePrState(state.getSessionProjectScmSnapshot(row.id), nowMs),
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
                borderRadius: terminal ? 2 : 8,
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
                                <WorkerSprite kind={spriteForModel(group.stateWorker?.model)} workerAgentId={group.stateWorker ? group.stateWorker.agentId ?? null : undefined} bulb={group.bulb} size={28} faceStyle={faceStyle} calm={calm} />
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
        <WorkDetailProjection excludeSessionId={coordinatorId ?? undefined}>{attentionBySession => (
        <View style={{ gap: 10, minWidth: 0, maxWidth: '100%' }}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, ...(terminal ? { paddingBottom: 7, borderBottomWidth: 1, borderBottomColor: paint.rule } : {}) }}>
                <Text accessibilityRole="header" style={{ color: terminal ? text.secondary : text.primary, fontSize: terminal ? 12 : 18, fontWeight: terminal ? '700' : '600', ...(terminal ? { textTransform: 'lowercase', letterSpacing: 0.48 } : {}) }}>
                    {terminal ? <Text accessible={false} style={{ color: paint.bot }}># </Text> : null}
                    {t('ignorePrevious.work')}
                </Text>
                <View style={{ flexDirection: 'row', marginLeft: 'auto', gap: 4 }}>
                    {modeButton(t('ignorePrevious.faces'), !details, () => setDetails(false))}
                    {modeButton(t('ignorePrevious.details'), details, () => setDetails(true))}
                </View>
            </View>
            <WorkCounts rows={rows} ready={ready} />
            {fixture ? <Text testID="ip-work-sample-inventory" style={{ color: text.secondary, fontSize: 12 }}>{t('ignorePrevious.workList.sampleInventory')}</Text> : null}
            <View style={{ gap: terminal ? 4 : 8, minWidth: 0, width: '100%' }}>
                {groups.map((group) => {
                    const key = group.issueKey ?? '';
                    const stateSession = group.stateWorker ? lookup.get(group.stateWorker.sessionId) : undefined;
                    const stuckStatus = group.bulb === 'stuck' && stateSession ? getSessionStatus(stateSession, nowMs) : null;
                    let attention: string | undefined;
                    if (group.stateWorker?.approvalDisabledReason) {
                        attention = waitingRestrictionLabel(group.stateWorker.approvalDisabledReason) ?? undefined;
                    } else if (group.bulb === 'turn') {
                        attention = attentionBySession.get(group.stateWorker?.sessionId ?? '') ?? t('ignorePrevious.needsLook');
                    } else if (stuckStatus) {
                        attention = stuckStatus.state === 'failed' ? t('ignorePrevious.workList.failed') : stuckStatus.statusText;
                    }
                    return (
                        <IssueCard
                            key={key || 'no-issue'}
                            group={group}
                            item={key ? workData.items.get(key) : null}
                            projectName={key ? workData.projectNames?.get(key.split('-')[0]) : undefined}
                            attention={attention}
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
        )}</WorkDetailProjection>
    );
}
