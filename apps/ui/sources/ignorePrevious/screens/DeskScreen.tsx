import * as React from 'react';
import { Pressable, ScrollView, useWindowDimensions, View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';

import { Icon, type IconName } from '@/components/ui/icons/Icon';
import { Text } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';
import type { Session } from '@/sync/domains/state/storageTypes';
import { useAllSessions } from '@/sync/store/hooks';
import { t } from '@/text';
import { getSessionName } from '@/utils/sessions/sessionUtils';

import { CoordinatorPane } from '../components/CoordinatorPane';
import { WaitingPanel } from '../components/WaitingPanel';
import { WorkColumn } from '../components/WorkColumn';
import { getDeskMinimised, getStoredCoordinatorId, setDeskMinimised, setStoredCoordinatorId } from '../deskPrefs';
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

function PanelToggle({ testID, icon, label, onPress }: { testID: string; icon: IconName; label: string; onPress: () => void }) {
    const { theme } = useUnistyles();
    return (
        <Pressable
            testID={testID}
            accessibilityRole="button"
            accessibilityLabel={label}
            onPress={onPress}
            hitSlop={8}
            style={{ padding: 6, borderRadius: 8, alignSelf: 'flex-end' }}
        >
            <Icon name={icon} size={20} color={theme.colors.text.secondary} />
        </Pressable>
    );
}

/**
 * The Ignore Previous desk: the coordinator's chat, what waits on you, and the work by issue.
 * Two columns when wide; stacked as Waiting, Coordinator, Work when narrow. Minimised, the
 * Waiting and Work panels shrink to a thin rail of faces and the coordinator gets the room.
 */
export function DeskScreen() {
    const { width, height } = useWindowDimensions();
    const sessions = useAllSessions();
    const [storedId, setStoredId] = React.useState(getStoredCoordinatorId);
    const [minimised, setMinimised] = React.useState(getDeskMinimised);
    const setPanels = React.useCallback((next: boolean) => {
        setDeskMinimised(next);
        setMinimised(next);
    }, []);

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

    const wide = width >= WIDE;
    const minimise = (
        <PanelToggle
            testID="ip-desk-minimise"
            icon={wide ? 'sidebar-right-close' : 'caret-up'}
            label={t('ignorePrevious.minimise')}
            onPress={() => setPanels(true)}
        />
    );
    const expand = (
        <PanelToggle
            testID="ip-desk-expand"
            icon={wide ? 'sidebar-right-open' : 'caret-down'}
            label={t('ignorePrevious.expand')}
            onPress={() => setPanels(false)}
        />
    );

    if (wide) {
        return (
            <View style={{ flex: 1, flexDirection: 'row', gap: 16, padding: 16 }}>
                <View style={{ flex: 3 }}>{coordinator}</View>
                {minimised ? (
                    <ScrollView style={{ width: 64, flexGrow: 0 }} contentContainerStyle={{ alignItems: 'center', gap: 16 }}>
                        {expand}
                        <WaitingPanel compact />
                        <WorkColumn compact="column" />
                    </ScrollView>
                ) : (
                    <ScrollView style={{ flex: 2 }} contentContainerStyle={{ gap: 20 }}>
                        {minimise}
                        <WaitingPanel />
                        <WorkColumn />
                    </ScrollView>
                )}
            </View>
        );
    }
    if (minimised) {
        return (
            <View style={{ flex: 1, gap: 8, padding: 12 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                    <WaitingPanel compact />
                    <View style={{ flex: 1 }}>
                        <WorkColumn compact="row" />
                    </View>
                    {expand}
                </View>
                <View style={{ flex: 1 }}>{coordinator}</View>
            </View>
        );
    }
    return (
        <ScrollView contentContainerStyle={{ gap: 20, padding: 12 }}>
            {minimise}
            <WaitingPanel />
            {/* The chat is a virtualised list, so inside a scroll view it needs a real height. */}
            <View style={{ height: Math.max(480, Math.round(height * 0.8)) }}>{coordinator}</View>
            <WorkColumn />
        </ScrollView>
    );
}
