import * as React from 'react';
import { Pressable, ScrollView, useWindowDimensions, View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';

import { Text } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';
import type { Session } from '@/sync/domains/state/storageTypes';
import { useAllSessions } from '@/sync/store/hooks';
import { t } from '@/text';
import { getSessionName } from '@/utils/sessions/sessionUtils';

import { CoordinatorPane } from '../components/CoordinatorPane';
import { WaitingPanel } from '../components/WaitingPanel';
import { WorkColumn } from '../components/WorkColumn';
import { getStoredCoordinatorId, setStoredCoordinatorId } from '../coordinatorStore';
import { pickCoordinatorSessionId } from '../model/coordinator';

const WIDE = 1100;
const COORDINATOR_PATH = process.env.EXPO_PUBLIC_IP_COORDINATOR_PATH ?? null;

function CoordinatorPicker({ sessions, onPick }: { sessions: readonly Session[]; onPick: (id: string) => void }) {
    const { theme } = useUnistyles();
    const choices = React.useMemo(
        () => sessions.filter((s) => !s.archivedAt).sort((a, b) => b.updatedAt - a.updatedAt),
        [sessions],
    );
    return (
        <View style={{ gap: 8, padding: 12 }}>
            <Text style={{ color: theme.colors.text.primary, fontSize: 18, ...Typography.default('semiBold') }}>
                {t('ignorePrevious.pickCoordinator')}
            </Text>
            <Text style={{ color: theme.colors.text.secondary, fontSize: 13, ...Typography.mono() }}>
                {t('ignorePrevious.pickHint')}
            </Text>
            {choices.map((session) => (
                <Pressable
                    key={session.id}
                    accessibilityRole="button"
                    onPress={() => onPick(session.id)}
                    style={{ padding: 10, borderRadius: 10, backgroundColor: theme.colors.surface.elevated }}
                >
                    <Text style={{ color: theme.colors.text.primary, fontSize: 15 }} numberOfLines={1}>
                        {getSessionName(session)}
                    </Text>
                </Pressable>
            ))}
        </View>
    );
}

/**
 * The Ignore Previous desk: the coordinator's chat, what waits on you, and the work by issue.
 * Two columns when wide; stacked as Waiting, Coordinator, Work when narrow.
 */
export function DeskScreen() {
    const { width, height } = useWindowDimensions();
    const sessions = useAllSessions();
    const [storedId, setStoredId] = React.useState(getStoredCoordinatorId);

    const coordinatorId = React.useMemo(
        () =>
            pickCoordinatorSessionId(
                sessions.map((s) => ({
                    id: s.id,
                    path: s.metadata?.path ?? '',
                    active: s.active,
                    archived: Boolean(s.archivedAt),
                    updatedAt: s.updatedAt,
                })),
                { storedId, coordinatorPath: COORDINATOR_PATH },
            ),
        [sessions, storedId],
    );

    const pick = React.useCallback((id: string) => {
        setStoredCoordinatorId(id);
        setStoredId(id);
    }, []);

    const coordinator = coordinatorId ? (
        <CoordinatorPane sessionId={coordinatorId} />
    ) : (
        <CoordinatorPicker sessions={sessions} onPick={pick} />
    );

    if (width >= WIDE) {
        return (
            <View style={{ flex: 1, flexDirection: 'row', gap: 16, padding: 16 }}>
                <View style={{ flex: 3 }}>{coordinator}</View>
                <ScrollView style={{ flex: 2 }} contentContainerStyle={{ gap: 20 }}>
                    <WaitingPanel />
                    <WorkColumn />
                </ScrollView>
            </View>
        );
    }
    return (
        <ScrollView contentContainerStyle={{ gap: 20, padding: 12 }}>
            <WaitingPanel />
            {/* The chat is a virtualised list, so inside a scroll view it needs a real height. */}
            <View style={{ height: Math.max(480, Math.round(height * 0.8)) }}>{coordinator}</View>
            <WorkColumn />
        </ScrollView>
    );
}
