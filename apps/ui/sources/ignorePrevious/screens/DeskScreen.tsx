import * as React from 'react';
import { Platform, Pressable, ScrollView, useWindowDimensions, View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, type IconName } from '@/components/ui/icons/Icon';
import { Text } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';
import type { SessionListRenderableSession } from '@/sync/domains/session/listing/sessionListRenderable';
import { t } from '@/text';
import { getSessionName } from '@/utils/sessions/sessionUtils';

import { DeskFontRoot } from '../fonts/DeskFontRoot';
import { CoordinatorPane } from '../components/CoordinatorPane';
import { ApprovalsButton, ApprovalsDrawer } from '../components/Approvals';
import { createWaitingHistory } from '../components/WaitingPanel';
import { DeskConnectionBanner } from '../components/DeskConnectionBanner';
import { WorkColumn } from '../components/WorkColumn';
import { CoordinatorCard } from '../components/CoordinatorCard';
import {
    getApprovalsOpen,
    setApprovalsOpen,
    setStoredCoordinatorId,
    useDeskPref,
} from '../deskPrefs';
import { useDeskWorkerRecordConsumers } from '../model/useDeskWorkerRecordConsumers';
import { DeskText } from '../typography/DeskText';
import { useCoordinatorId } from '../model/useCoordinatorId';
import { drawerPlacement, isDeskPhoneWidth } from '../model/drawerPlacement';
import { DeskTopBar } from '../components/DeskTopBar';
import { SessionsSheet } from '../components/SessionsSheet';
import { useDeskSessions } from '../useDeskSessions';
import { DeskBrowserNotifier } from '../model/useDeskBrowserNotifier';

const WIDE = 1100;

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

function PhoneTabBar({ children }: React.PropsWithChildren) {
    if (Platform.OS !== 'web') return <NativePhoneTabBar>{children}</NativePhoneTabBar>;
    return <PhoneTabBarContent bottom={0}>{children}</PhoneTabBarContent>;
}

function NativePhoneTabBar({ children }: React.PropsWithChildren) {
    const insets = useSafeAreaInsets();
    return <PhoneTabBarContent bottom={insets.bottom}>{children}</PhoneTabBarContent>;
}

function PhoneTabBarContent({ children, bottom }: React.PropsWithChildren<{ bottom: number }>) {
    const { theme } = useUnistyles();
    return <View accessibilityRole="tablist" style={{ flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center', minWidth: 0, borderTopWidth: 1, borderTopColor: theme.colors.border.default, paddingBottom: bottom }}>{children}</View>;
}

/** One open state across all placements, persisted only on explicit dismissal or opening. */
function useApprovalsDrawer(width: number) {
    const [{ open, focusOnOpen }, setState] = React.useState(() => ({
        open: drawerPlacement(width) !== 'fullscreen' && getApprovalsOpen(),
        focusOnOpen: false,
    }));
    const change = React.useCallback((next: boolean) => {
        setApprovalsOpen(next);
        setState({ open: next, focusOnOpen: next });
    }, []);
    const toggle = React.useCallback(() => change(!open), [change, open]);
    const close = React.useCallback(() => change(false), [change]);
    return { open, focusOnOpen, toggle, close };
}

/**
 * The Ignore Previous desk: the coordinator's chat in the middle, the work by issue beside it
 * (left when wide, above when narrow) and what waits on you in a drawer on the right. The Work
 * panel collapses to a rail of issue keys and states; both choices survive a reload.
 */
export function DeskScreen() {
    const { theme } = useUnistyles();
    const router = useRouter();
    const { width, height } = useWindowDimensions();
    // Until the session list arrives an empty desk means "not loaded yet", not "no sessions".
    const { list: sessions, ready: dataReady } = useDeskSessions();
    const [workCollapsed, collapseWork] = useDeskPref('workCollapsed');
    const [waitingHistory] = React.useState(createWaitingHistory);
    const [hasHalfAnsweredCard, setHasHalfAnsweredCard] = React.useState(false);
    const approvals = useApprovalsDrawer(width);
    const phone = isDeskPhoneWidth(width);
    const [phonePane, setPhonePane] = React.useState<'work' | 'shog'>('shog');
    const [sessionsOpen, setSessionsOpen] = React.useState(false);
    const sessionsRef = React.useRef<View>(null);
    const previousPhone = React.useRef(phone);
    React.useEffect(() => {
        if (previousPhone.current !== phone) setSessionsOpen(false);
        previousPhone.current = phone;
    }, [phone]);

    const approvalsOpenerRef = React.useRef<View>(null);

    const coordinatorId = useCoordinatorId(sessions);
    useDeskWorkerRecordConsumers(sessions, coordinatorId);

    // Not persisted: a reload while choosing shows the stored coordinator again.
    const [changing, setChanging] = React.useState(false);
    // Every desk consumer of the coordinator id hears the stored pick. The stored id is never cleared.
    const pick = React.useCallback((id: string) => {
        setStoredCoordinatorId(id);
        setChanging(false);
    }, []);

    const approvalsButton = <ApprovalsButton phone={phone} openerRef={approvalsOpenerRef} open={approvals.open} onPress={approvals.toggle} />;
    const settingsButton = (
        <Pressable
            testID="ip-settings-open"
            accessibilityRole="button"
            accessibilityLabel={t('ignorePrevious.settings.title')}
            onPress={() => router.navigate('/desk/settings')}
            style={{ paddingHorizontal: 12, minHeight: 48, justifyContent: 'center' }}
        >
            <Icon name="gear" size={20} color={theme.colors.text.secondary} />
        </Pressable>
    );
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
                </>
            }
        />
    ) : (
        <ScrollView contentContainerStyle={{ gap: 8 }}>
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
    const coordinatorCard = (form: 'full' | 'slim' | 'rail') => coordinatorId ? (
        <CoordinatorCard sessionId={coordinatorId} form={form} onOpen={() => { setChanging(false); setPhonePane('shog'); }} />
    ) : null;
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
                horizontal={false}
                showsHorizontalScrollIndicator={false}
                style={{ width: 76, flexGrow: 0, flexShrink: 0, overflow: 'hidden', ...divider }}
                contentContainerStyle={{ gap: 4, paddingVertical: 8, paddingHorizontal: 6, alignItems: 'center' }}
            >
                {expand}
                {coordinatorCard('rail')}
                <WorkColumn compact="column" />
            </ScrollView>
        ) : (
            <ScrollView testID="ip-work" horizontal={false} showsHorizontalScrollIndicator={false} style={{ width: 360, minWidth: 0, flexGrow: 0, flexShrink: 0, overflow: 'hidden', ...divider }} contentContainerStyle={{ gap: 8, padding: 10 }}>
                <View style={{ alignItems: 'flex-end' }}>{collapse}</View>
                {coordinatorCard('slim')}
                <WorkColumn />
            </ScrollView>
        );
    } else {
        work = workCollapsed && !phone ? (
            <View testID="ip-work-rail" style={{ flexDirection: 'row', alignItems: 'flex-start', minWidth: 0, maxHeight: Math.round(height * 0.45), gap: 8, padding: 8, ...divider }}>
                <ScrollView horizontal={false} showsHorizontalScrollIndicator={false} style={{ flex: 1, minWidth: 0, maxHeight: Math.max(0, Math.round(height * 0.45) - 16), overflow: 'hidden' }} contentContainerStyle={{ minWidth: 0 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 4, minWidth: 0 }}>
                        {coordinatorCard('rail')}
                        <View style={{ flex: 1, minWidth: 0 }}><WorkColumn compact="row" /></View>
                    </View>
                </ScrollView>
                {expand}
            </View>
        ) : (
            <ScrollView
                testID="ip-work"
                horizontal={false}
                showsHorizontalScrollIndicator={false}
                style={{ minWidth: 0, overflow: 'hidden', maxHeight: phone ? undefined : Math.round(height * 0.45), flexGrow: phone ? 1 : 0, ...divider }}
                contentContainerStyle={{ gap: 8, padding: 12 }}
            >
                {!phone && <View style={{ alignItems: 'flex-end' }}>{collapse}</View>}
                {coordinatorCard(phone && phonePane === 'work' ? 'full' : 'slim')}
                <WorkColumn />
            </ScrollView>
        );
    }

    const main = (
        <View style={{ flex: 1, flexDirection: wide ? 'row' : 'column' }}>
            <View style={[wide ? undefined : { minWidth: 0 }, phone ? { flex: 1, display: phonePane === 'work' ? 'flex' : 'none' } : undefined]}>{work}</View>
            <View testID="ip-coordinator-pane-wrapper" style={{ flex: 1, minWidth: 0, display: phone && phonePane !== 'shog' ? 'none' : 'flex' }}>{coordinator}</View>
        </View>
    );

    return (
        <DeskFontRoot>
            <DeskBrowserNotifier coordinatorId={coordinatorId} />
            <View style={{ flex: 1, flexDirection: 'row', minWidth: 0, overflow: 'hidden' }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                    <DeskTopBar phone={phone} sessionsRef={sessionsRef} onSessions={() => setSessionsOpen(true)} waiting={approvalsButton} settings={settingsButton} />
                    <DeskConnectionBanner />
                    {main}
                    {phone && <PhoneTabBar>
                        <Pressable testID="ip-tab-work" accessibilityRole="tab" aria-selected={phonePane === 'work' && !approvals.open} accessibilityState={{ selected: phonePane === 'work' && !approvals.open }} onPress={() => { if (approvals.open) approvals.close(); setPhonePane('work'); }} style={{ padding: 8 }}><DeskText style={{ color: theme.colors.text.primary, fontSize: 12.5, letterSpacing: -0.25 }}>{t('ignorePrevious.work')}</DeskText></Pressable>
                        <Pressable testID="ip-tab-shog" accessibilityRole="tab" aria-selected={phonePane === 'shog' && !approvals.open} accessibilityState={{ selected: phonePane === 'shog' && !approvals.open }} onPress={() => { if (approvals.open) approvals.close(); setPhonePane('shog'); }} style={{ padding: 8 }}><DeskText style={{ color: theme.colors.text.primary, fontSize: 12.5, letterSpacing: -0.25 }}>{t('ignorePrevious.topBar.shog')}</DeskText></Pressable>
                        {approvalsButton}
                    </PhoneTabBar>}
                    {sessionsOpen && <SessionsSheet openerRef={sessionsRef} onClose={() => setSessionsOpen(false)} />}
                </View>
                <ApprovalsDrawer open={approvals.open} width={width} openerRef={approvalsOpenerRef} focusOnOpen={approvals.focusOnOpen}
                    hasHalfAnsweredCard={hasHalfAnsweredCard} onDirtyChange={setHasHalfAnsweredCard}
                    onClose={approvals.close} history={waitingHistory} />
            </View>
        </DeskFontRoot>
    );
}
