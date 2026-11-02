import * as React from 'react';
import { Pressable, ScrollView, useWindowDimensions, View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';

import { AppPaneScopeHost } from '@/components/appShell/panes/AppPaneScopeHost';
import { useAppPaneScope } from '@/components/appShell/panes/hooks/useAppPaneScope';
import { canLayoutHostSessionPane } from '@/components/sessions/panes/open/sessionOpenTarget';
import { useSessionOpenLayout } from '@/components/sessions/panes/open/useSessionOpenLayout';
import { Icon, type IconName } from '@/components/ui/icons/Icon';
import { Text } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';
import { Modal } from '@/modal';
import type { SessionListRenderableSession } from '@/sync/domains/session/listing/sessionListRenderable';
import { t } from '@/text';
import { getSessionName } from '@/utils/sessions/sessionUtils';

import { DeskFontRoot } from '../fonts/DeskFontRoot';
import { CoordinatorPane } from '../components/CoordinatorPane';
import { ApprovalsButton, ApprovalsCard, ApprovalsDrawer } from '../components/Approvals';
import { createWaitingHistory, type WaitingHistory } from '../components/WaitingPanel';
import { DeskConnectionBanner } from '../components/DeskConnectionBanner';
import { WorkColumn } from '../components/WorkColumn';
import {
    getApprovalsOpen,
    getWorkCollapsed,
    setApprovalsOpen,
    setStoredCoordinatorId,
    setWorkCollapsed,
} from '../deskPrefs';
import { useCoordinatorId } from '../model/useCoordinatorId';
import { useDeskSessions } from '../useDeskSessions';

const WIDE = 1100;
const SCOPE_ID = 'ignorePrevious:desk';

function CoordinatorPicker({
    sessions,
    onPick,
    onCancel,
}: {
    sessions: readonly SessionListRenderableSession[];
    onPick: (id: string) => void;
    /** Set while changing an existing coordinator: going back keeps it. */
    onCancel?: () => void;
}) {
    const { theme } = useUnistyles();
    const choices = React.useMemo(
        () => [...sessions].sort((a, b) => b.updatedAt - a.updatedAt),
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
            {onCancel ? (
                <Pressable
                    testID="ip-coordinator-change-cancel"
                    accessibilityRole="button"
                    accessibilityLabel={t('common.cancel')}
                    onPress={onCancel}
                    style={{ alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: theme.colors.surface.inset }}
                >
                    <Text style={{ color: theme.colors.text.primary, fontSize: 13 }}>{t('common.cancel')}</Text>
                </Pressable>
            ) : null}
            {choices.map((session) => (
                <Pressable
                    key={session.id}
                    testID={`ip-pick-${session.id}`}
                    accessibilityRole="button"
                    accessibilityLabel={getSessionName(session)}
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
            style={{ padding: 6, borderRadius: 8 }}
        >
            <Icon name={icon} size={20} color={theme.colors.text.secondary} />
        </Pressable>
    );
}

/**
 * The approvals drawer's open state. Happier's pane state lives in memory, so the last choice is
 * kept in deskPrefs: restored with an in-memory pane open on mount, and saved whenever the drawer
 * opens or closes, including when the pane host closes it (the phone overlay's backdrop).
 */
function useApprovalsDrawer(history: WaitingHistory) {
    const { scopeState, openRight, closeRight } = useAppPaneScope(SCOPE_ID);
    // Where no pane can be drawn (a phone, or multi-pane switched off) the list opens as a card
    // instead, and the stored choice waits for a layout that has room for the drawer.
    const canDraw = canLayoutHostSessionPane(useSessionOpenLayout(), 'right');
    const open = canDraw && Boolean(scopeState?.right.isOpen);

    React.useEffect(() => {
        if (canDraw && getApprovalsOpen()) openRight();
    }, [canDraw, openRight]);

    const previous = React.useRef(open);
    React.useEffect(() => {
        if (previous.current === open) return;
        previous.current = open;
        if (canDraw && getApprovalsOpen() !== open) setApprovalsOpen(open);
    }, [open, canDraw]);

    const toggle = React.useCallback(() => {
        if (!canDraw) Modal.show({ component: ApprovalsCard, props: { history } });
        else if (open) closeRight();
        else openRight();
    }, [canDraw, open, openRight, closeRight, history]);
    return { open, toggle, close: closeRight };
}

/**
 * The Ignore Previous desk: the coordinator's chat in the middle, the work by issue beside it
 * (left when wide, above when narrow) and what waits on you in a drawer on the right. The Work
 * panel collapses to a rail of issue keys and states; both choices survive a reload.
 */
export function DeskScreen() {
    const { theme } = useUnistyles();
    const { width, height } = useWindowDimensions();
    // Until the session list arrives an empty desk means "not loaded yet", not "no sessions".
    const { list: sessions, ready: dataReady } = useDeskSessions();
    const [workCollapsed, setCollapsed] = React.useState(getWorkCollapsed);
    const collapseWork = React.useCallback((next: boolean) => {
        setWorkCollapsed(next);
        setCollapsed(next);
    }, []);
    const [waitingHistory] = React.useState(createWaitingHistory);
    const approvals = useApprovalsDrawer(waitingHistory);

    const coordinatorId = useCoordinatorId(sessions);

    // Not persisted: a reload while choosing shows the stored coordinator again.
    const [changing, setChanging] = React.useState(false);
    // Every desk consumer of the coordinator id hears the stored pick. The stored id is never cleared.
    const pick = React.useCallback((id: string) => {
        setStoredCoordinatorId(id);
        setChanging(false);
    }, []);

    const approvalsButton = <ApprovalsButton open={approvals.open} onPress={approvals.toggle} />;
    const coordinator = coordinatorId && !changing ? (
        <CoordinatorPane
            sessionId={coordinatorId}
            headerAccessory={
                <>
                    <PanelToggle
                        testID="ip-coordinator-change"
                        icon="arrows-left-right"
                        label={t('ignorePrevious.changeCoordinator')}
                        onPress={() => setChanging(true)}
                    />
                    {approvalsButton}
                </>
            }
        />
    ) : (
        <ScrollView contentContainerStyle={{ gap: 8 }}>
            <View style={{ alignSelf: 'flex-end', padding: 12 }}>{approvalsButton}</View>
            {dataReady ? (
                <CoordinatorPicker
                    sessions={sessions}
                    onPick={pick}
                    onCancel={coordinatorId ? () => setChanging(false) : undefined}
                />
            ) : null}
        </ScrollView>
    );

    const wide = width >= WIDE;
    const collapse = (
        <PanelToggle
            testID="ip-work-collapse"
            icon={wide ? 'sidebar-left-close' : 'caret-up'}
            label={t('ignorePrevious.collapseWork')}
            onPress={() => collapseWork(true)}
        />
    );
    const expand = (
        <PanelToggle
            testID="ip-work-expand"
            icon={wide ? 'sidebar-left-open' : 'caret-down'}
            label={t('ignorePrevious.expandWork')}
            onPress={() => collapseWork(false)}
        />
    );
    const divider = wide
        ? { borderRightWidth: 1, borderRightColor: theme.colors.border.default }
        : { borderBottomWidth: 1, borderBottomColor: theme.colors.border.default };

    let work: React.ReactNode;
    if (wide) {
        work = workCollapsed ? (
            <ScrollView
                testID="ip-work-rail"
                style={{ width: 104, flexGrow: 0, ...divider }}
                contentContainerStyle={{ gap: 12, padding: 12 }}
            >
                {expand}
                <WorkColumn compact="column" />
            </ScrollView>
        ) : (
            <ScrollView testID="ip-work" style={{ width: 360, flexGrow: 0, ...divider }} contentContainerStyle={{ gap: 8, padding: 16 }}>
                <View style={{ alignItems: 'flex-end' }}>{collapse}</View>
                <WorkColumn />
            </ScrollView>
        );
    } else {
        work = workCollapsed ? (
            <View testID="ip-work-rail" style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 8, ...divider }}>
                <ScrollView horizontal style={{ flex: 1 }} contentContainerStyle={{ alignItems: 'center' }}>
                    <WorkColumn compact="row" />
                </ScrollView>
                {expand}
            </View>
        ) : (
            <ScrollView
                testID="ip-work"
                style={{ maxHeight: Math.round(height * 0.45), flexGrow: 0, ...divider }}
                contentContainerStyle={{ gap: 8, padding: 12 }}
            >
                <View style={{ alignItems: 'flex-end' }}>{collapse}</View>
                <WorkColumn />
            </ScrollView>
        );
    }

    const main = (
        <View style={{ flex: 1, flexDirection: wide ? 'row' : 'column' }}>
            {work}
            <View style={{ flex: 1 }}>{coordinator}</View>
        </View>
    );

    return (
        <DeskFontRoot>
            <View style={{ flex: 1 }}>
                <DeskConnectionBanner />
                <AppPaneScopeHost scopeId={SCOPE_ID} main={main} rightPane={<ApprovalsDrawer onClose={approvals.close} history={waitingHistory} />} />
            </View>
        </DeskFontRoot>
    );
}
