import * as React from 'react';
import { Pressable, View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';

import { Text } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';
import type { Session } from '@/sync/domains/state/storageTypes';
import { useAllSessions, useSessionScmStatus } from '@/sync/store/hooks';
import { t } from '@/text';
import { getSessionName, getSessionStatus } from '@/utils/sessions/sessionUtils';

import { bulbFromSessionState, type Bulb } from '../model/bulb';
import { groupWorkersByIssue, type WorkerRow } from '../model/groupWorkers';
import { issueKeyFromBranch, issueKeyFromPath } from '../model/issueKey';
import { bulbColour, useIpColours } from '../palette';
import { IssueCard } from './IssueCard';

type Branches = Readonly<Record<string, string | null>>;

/** Reports one session's git branch. Hooks can't run in a loop, so each session gets its own probe. */
const BranchProbe = React.memo(function BranchProbe({
    sessionId,
    onBranch,
}: {
    sessionId: string;
    onBranch: (sessionId: string, branch: string | null) => void;
}) {
    const branch = useSessionScmStatus(sessionId)?.branch ?? null;
    React.useEffect(() => onBranch(sessionId, branch), [sessionId, branch, onBranch]);
    return null;
});

function toWorkerRows(sessions: readonly Session[], branches: Branches): WorkerRow[] {
    return sessions.map((session) => ({
        sessionId: session.id,
        title: getSessionName(session),
        // The branch names the issue more reliably than the folder; the folder covers sessions with no git status yet.
        issueKey: issueKeyFromBranch(branches[session.id] ?? null) ?? issueKeyFromPath(session.metadata?.path ?? ''),
        bulb: bulbFromSessionState(getSessionStatus(session).state),
        permissionMode: session.permissionMode ?? 'default',
        updatedAt: session.updatedAt,
    }));
}

const COUNTED: readonly { bulb: Bulb; label: () => string }[] = [
    { bulb: 'turn', label: () => t('ignorePrevious.countTurn') },
    { bulb: 'stuck', label: () => t('ignorePrevious.countStuck') },
    { bulb: 'working', label: () => t('ignorePrevious.countWorking') },
    { bulb: 'idle', label: () => t('ignorePrevious.countIdle') },
];

/** How many agents are in each state, as plain numbers, so nobody has to count bulbs. */
function WorkCounts({ rows }: { rows: readonly WorkerRow[] }) {
    const { theme } = useUnistyles();
    const colours = useIpColours();
    const counts: Record<Bulb, number> = { turn: 0, stuck: 0, working: 0, idle: 0 };
    for (const row of rows) counts[row.bulb] += 1;

    const tile = (id: string, value: number, label: string, dot: string | null) => (
        <View key={id} style={{ minWidth: 64, gap: 2 }}>
            <Text
                testID={`ip-count-${id}`}
                style={{ color: theme.colors.text.primary, fontSize: 22, ...Typography.default('semiBold') }}
            >
                {value}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                {dot ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: dot }} /> : null}
                <Text style={{ color: theme.colors.text.secondary, fontSize: 12 }}>{label}</Text>
            </View>
        </View>
    );

    return (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 16 }}>
            {tile('all', rows.length, t('ignorePrevious.countAll'), null)}
            {COUNTED.map(({ bulb, label }) => tile(bulb, counts[bulb], label(), bulbColour(colours, bulb)))}
        </View>
    );
}

/**
 * Every unarchived session grouped by the issue it works on. Faces shows folded cards you open one
 * at a time; Details opens them all.
 */
export function WorkColumn() {
    const { theme } = useUnistyles();
    const sessions = useAllSessions();
    const live = React.useMemo(() => sessions.filter((session) => !session.archivedAt), [sessions]);
    const [branches, setBranches] = React.useState<Branches>({});
    const [details, setDetails] = React.useState(false);
    const [openKeys, setOpenKeys] = React.useState<ReadonlySet<string>>(() => new Set());

    const onBranch = React.useCallback((sessionId: string, branch: string | null) => {
        setBranches((prev) => (prev[sessionId] === branch ? prev : { ...prev, [sessionId]: branch }));
    }, []);

    const rows = React.useMemo(() => toWorkerRows(live, branches), [live, branches]);
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
                backgroundColor: active ? theme.colors.surface.inset : 'transparent',
            }}
        >
            <Text style={{ color: active ? theme.colors.text.primary : theme.colors.text.secondary, fontSize: 13 }}>{label}</Text>
        </Pressable>
    );

    return (
        <View style={{ gap: 12 }}>
            {live.map((session) => (
                <BranchProbe key={session.id} sessionId={session.id} onBranch={onBranch} />
            ))}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={{ color: theme.colors.text.primary, fontSize: 18, ...Typography.default('semiBold') }}>
                    {t('ignorePrevious.work')}
                </Text>
                <View style={{ flexDirection: 'row', marginLeft: 'auto', gap: 4 }}>
                    {modeButton(t('ignorePrevious.faces'), !details, () => setDetails(false))}
                    {modeButton(t('ignorePrevious.details'), details, () => setDetails(true))}
                </View>
            </View>
            <WorkCounts rows={rows} />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                {groups.map((group) => {
                    const key = group.issueKey ?? '';
                    return (
                        <IssueCard
                            key={key || 'no-issue'}
                            group={group}
                            open={details || openKeys.has(key)}
                            onToggle={() => toggle(key)}
                        />
                    );
                })}
            </View>
        </View>
    );
}
