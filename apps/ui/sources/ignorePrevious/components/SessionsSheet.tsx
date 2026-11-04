import * as React from 'react';
import { Platform, Pressable, ScrollView, useWindowDimensions, View } from 'react-native';

import { TextInput } from '@/components/ui/text/Text';
import { Icon } from '@/components/ui/icons/Icon';
import { useActiveServerSnapshot } from '@/hooks/server/useActiveServerSnapshot';
import { getActiveServerAccountScope } from '@/sync/domains/scope/activeServerAccountScope';
import { areServerAccountScopesEqual, serverAccountScopeKeySuffix, type ServerAccountScope } from '@/sync/domains/scope/serverAccountScope';
import { areServerProfileIdentifiersEquivalent } from '@/sync/domains/server/serverProfiles';
import { isUserFacingSession } from '@/sync/domains/session/listing/isUserFacingSession';
import { buildSessionListRenderableFromSession } from '@/sync/domains/session/listing/sessionListRenderable';
import { storage } from '@/sync/domains/state/storage';
import { sync, type SessionListPagingState } from '@/sync/sync';
import { registerSessionRealtimeRecordConsumer } from '@/sync/runtime/sessionRealtimeRecordConsumers';
import { getPermissionModeLabelForAgentType } from '@/sync/domains/permissions/permissionModeOptions';
import { getSessionName } from '@/utils/sessions/sessionUtils';
import { t } from '@/text';

import { DESK_FONT_STACK } from '../fonts/deskFont';
import { DeskFixtureRouteContext } from '../deskFixtureGate';
import { useDeskSessionNavigation } from '../useDeskSessionNavigation';
import { useDeskSessions } from '../useDeskSessions';
import { useCoordinatorId } from '../model/useCoordinatorId';
import { useIssueKeys } from '../model/useIssueKeys';
import { hasSessionIssueMetadata } from '../model/resolveIssue';
import { workerPermissionMode } from '../model/workerPermissionMode';
import { groupWorkersByIssue } from '../model/groupWorkers';
import { useDeskNow } from '../model/useDeskNow';
import { isDeskPhoneWidth } from '../model/drawerPlacement';
import { useDeskPopup } from '../popups/useDeskPopup';
import { DeskText } from '../typography/DeskText';
import { toWorkerRows } from './WorkColumn';
import { bulbWord } from './BulbLabel';
import { useTopBarAppearance } from './topBarAppearance';

const fixturePagingState: SessionListPagingState = { status: 'exhausted', retry: null, hasUnmaterializedRows: false };

type SheetProps = { openerRef: React.RefObject<View | null>; onClose: () => void };

export function SessionsSheet(props: SheetProps) {
    const activeServer = useActiveServerSnapshot();
    const profileScope = storage(state => state.profileScope);
    const fixture = React.useContext(DeskFixtureRouteContext);
    const scope = profileScope && areServerProfileIdentifiersEquivalent(profileScope.serverId, activeServer.serverId) ? profileScope : null;
    // Search, paging errors and expansion belong to one account on one server.
    return <ScopedSessionsSheet key={fixture ? 'fixture' : scope ? serverAccountScopeKeySuffix(scope) : 'pending'} {...props} scope={scope} fixture={fixture} />;
}

function SheetButton({ id, label, onPress, disabled, children }: {
    id: string; label?: string; onPress: () => void; disabled?: boolean; children: React.ReactNode;
}) {
    const { terminal, paint } = useTopBarAppearance();
    const { width } = useWindowDimensions();
    const minHeight = Platform.OS === 'web' && !isDeskPhoneWidth(width) ? 28 : Platform.OS === 'android' ? 48 : 44;
    const [focused, setFocused] = React.useState(false);
    return <Pressable testID={id} accessibilityRole="button" accessibilityLabel={label} disabled={disabled}
        accessibilityState={{ disabled: Boolean(disabled) }} onPress={onPress} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
        style={{ minHeight, minWidth: 44, paddingHorizontal: 8, paddingVertical: 5, justifyContent: 'center',
            borderWidth: 1, borderColor: focused ? paint.bot : paint.rule, borderRadius: terminal ? 2 : 8,
            backgroundColor: paint.panel2, opacity: disabled ? 0.6 : 1 }}>
        {children}
    </Pressable>;
}

function ScopedSessionsSheet({ openerRef, onClose, scope, fixture }: SheetProps & { scope: ServerAccountScope | null; fixture: boolean }) {
    const { terminal, paint } = useTopBarAppearance();
    const navigateToSession = useDeskSessionNavigation();
    const contentRef = React.useRef<View>(null);
    const [search, setSearch] = React.useState('');
    const [searchFocused, setSearchFocused] = React.useState(false);
    const [showArchived, setShowArchived] = React.useState(false);
    const archivePaging = React.useSyncExternalStore(sync.subscribeSessionListPagingState, () => fixture ? fixturePagingState : sync.getSessionListPagingState('archived'));
    const currentPaging = React.useSyncExternalStore(sync.subscribeSessionListPagingState, () => fixture ? fixturePagingState : sync.getSessionListPagingState('current'));
    const archiveState = archivePaging.status;
    const currentState = currentPaging.status;
    const [archiveRequestPending, setArchiveRequestPending] = React.useState(false);
    const [currentRequestPending, setCurrentRequestPending] = React.useState(false);
    const [settledQuery, setSettledQuery] = React.useState('');
    const archiveInFlight = React.useRef(false);
    const currentInFlight = React.useRef(false);
    const mounted = React.useRef(false);
    React.useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    const desk = useDeskSessions();
    const renderables = storage(state => state.sessionListRenderables);
    const deleted = storage(state => state.deletedSessionIds);
    const ready = desk.ready && (fixture || scope !== null);
    const belongsToScope = React.useCallback((id: string) => {
        const serverId = desk.lookup.get(id)?.serverId;
        return !deleted[id] && (fixture || !serverId || Boolean(scope && areServerProfileIdentifiersEquivalent(serverId, scope.serverId)));
    }, [desk.lookup, deleted, fixture, scope]);
    const current = React.useMemo(() => ({ ...desk, list: ready ? desk.list.filter(row => belongsToScope(row.id)) : [] }), [desk, ready, belongsToScope]);
    const archives = React.useMemo(() => {
        if (!ready) return [];
        // Archiving can evict a sidebar row without evicting its full record. Reuse
        // the canonical projection for that record, never another server's cached list.
        const rows = new Map(Object.values(renderables).filter(row => row.archivedAt).map(row => [row.id, row]));
        for (const session of desk.lookup.values()) {
            if (session.archivedAt && !renderables[session.id]) rows.set(session.id, buildSessionListRenderableFromSession(session));
        }
        return [...rows.values()].filter(row => belongsToScope(row.id)
            && (fixture || sync.isArchivedSessionListRowCurrent(row.id, row.metadataVersion)))
            .sort((a, b) => (b.archivedAt ?? 0) - (a.archivedAt ?? 0) || b.updatedAt - a.updatedAt);
    }, [ready, renderables, desk.lookup, belongsToScope, fixture, archivePaging]);
    const readableArchives = React.useMemo(() => archives.filter(row => row.metadata !== null && isUserFacingSession(row)), [archives]);
    const all = React.useMemo(() => ({ ...current, list: [...current.list, ...readableArchives] }), [current, readableArchives]);
    const issueKeys = useIssueKeys(all);
    const unresolvedIssueRows = React.useMemo(() => all.list.filter(row => row.metadata !== null
        && !hasSessionIssueMetadata(row, all.lookup.get(row.id))), [all]);
    React.useEffect(() => {
        if (fixture || !scope) return;
        // The open sheet needs authoritative identity even for archive/list-only rows.
        // The existing record owner shares and schedules the exact hydration.
        const releases = unresolvedIssueRows.map(row => registerSessionRealtimeRecordConsumer(row.id, scope.serverId));
        return () => { releases.forEach(release => release()); };
    }, [fixture, scope, unresolvedIssueRows]);
    const coordinatorId = useCoordinatorId(current.list);
    const now = useDeskNow();
    const workers = React.useMemo(() => toWorkerRows(all.list, all.lookup, issueKeys, now), [all, issueKeys, now]);
    const groups = React.useMemo(() => {
        const ids = new Set(current.list.map(row => row.id));
        return groupWorkersByIssue(workers.filter(worker => worker.sessionId !== coordinatorId && ids.has(worker.sessionId)));
    }, [current.list, workers, coordinatorId]);
    const rowContexts = React.useMemo(() => {
        const rows = new Map(all.list.map(row => [row.id, row]));
        return new Map(workers.map(worker => {
            const row = rows.get(worker.sessionId)!;
            const loaded = all.lookup.get(row.id);
            const mode = loaded && hasSessionIssueMetadata(row, loaded) ? workerPermissionMode(loaded).current : null;
            const modeLabel = mode && worker.agentId ? getPermissionModeLabelForAgentType(worker.agentId, mode)
                : t('ignorePrevious.workerControl.modeUnknown');
            return [row.id, t('ignorePrevious.sessions.rowContext', { state: bulbWord(worker.bulb), mode: modeLabel })];
        }));
    }, [all, workers]);
    useDeskPopup({ open: true, onClose, openerRef, contentRef, returnFocusOnClose: true });

    const isCurrentScope = React.useCallback(() => fixture || areServerAccountScopesEqual(scope, getActiveServerAccountScope()), [fixture, scope]);
    const loadArchives = React.useCallback(async (firstPage: boolean) => {
        if (fixture || !scope || !isCurrentScope() || archiveInFlight.current) return;
        archiveInFlight.current = true;
        setArchiveRequestPending(true);
        try {
            if (firstPage) await sync.fetchArchivedSessions();
            else await sync.fetchMoreArchivedSessions();
        } catch {
            // Loaded matches remain usable, with a visible retry for the failed page.
            // The canonical pager publishes its error; retry retains the failed cursor.
        } finally {
            archiveInFlight.current = false;
            if (mounted.current && isCurrentScope()) setArchiveRequestPending(false);
        }
    }, [fixture, scope, isCurrentScope]);
    React.useEffect(() => { if (ready) void loadArchives(true); }, [ready, loadArchives]);
    const loadCurrent = React.useCallback(async (firstPage = false) => {
        if (fixture || !scope || !isCurrentScope() || currentInFlight.current) return;
        currentInFlight.current = true;
        setCurrentRequestPending(true);
        try {
            if (firstPage) await sync.refreshSessions({ awaitSessionListHydration: true });
            else await sync.fetchMoreSessions();
        } catch {
            // The canonical pager owns error state and keeps the retry cursor.
        } finally {
            currentInFlight.current = false;
            if (mounted.current && isCurrentScope()) setCurrentRequestPending(false);
        }
    }, [fixture, scope, isCurrentScope]);
    const openSession = (id: string) => {
        if (!isCurrentScope() || storage.getState().deletedSessionIds[id]) return;
        onClose();
        void navigateToSession(id, scope ? { serverId: scope.serverId } : undefined);
    };
    const query = search.trim().toLocaleLowerCase();
    React.useEffect(() => {
        // Filter loaded rows immediately; start network progression only after typing settles.
        const timer = setTimeout(() => setSettledQuery(query), 300);
        return () => clearTimeout(timer);
    }, [query]);
    const coordinator = current.list.find(row => row.id === coordinatorId);
    const entries = [
        { title: t('ignorePrevious.topBar.coordinator'), rows: coordinator ? [{ id: coordinator.id, title: getSessionName(coordinator), searchable: coordinator.metadata !== null }] : [] },
        { title: t('ignorePrevious.topBar.onIssues'), rows: groups.filter(g => g.issueKey !== null).flatMap(g => g.workers.map(w => ({ id: w.sessionId, title: `${g.issueKey} ${w.title}`, searchable: renderables[w.sessionId]?.metadata != null }))) },
        { title: t('ignorePrevious.noIssue'), rows: groups.filter(g => g.issueKey === null).flatMap(g => g.workers.map(w => ({ id: w.sessionId, title: w.title, searchable: renderables[w.sessionId]?.metadata != null }))) },
    ].map(group => ({ ...group, rows: group.rows.filter(row => (!query || row.searchable) && row.title.toLocaleLowerCase().includes(query)) }));
    const archivedRows = readableArchives.map(row => {
        const issue = issueKeys.get(row.id);
        return { id: row.id, title: `${issue ? `${issue} ` : ''}${getSessionName(row)}` };
    }).filter(row => row.title.toLocaleLowerCase().includes(query));
    const pending = !ready || archiveState === 'loading' || currentState === 'loading' || archiveRequestPending || currentRequestPending;
    const hasMatches = entries.some(group => group.rows.length > 0) || archivedRows.length > 0;
    React.useEffect(() => {
        if (!ready || fixture || !query || query !== settledQuery || hasMatches || pending) return;
        // One page per settled render: newly applied matches stop the next request.
        // Cleanup/query changes never abort a canonical pager shared with other callers.
        if (currentState === 'more') void loadCurrent();
        else if (archiveState === 'more') void loadArchives(false);
    }, [ready, fixture, query, settledQuery, hasMatches, pending, currentState, archiveState, loadCurrent, loadArchives]);
    const unreadable = ready && (unresolvedIssueRows.length > 0 || currentPaging.hasUnmaterializedRows || archivePaging.hasUnmaterializedRows
        || [...Object.values(renderables).filter(row => !row.archivedAt), ...archives].some(row => belongsToScope(row.id)
            && (row.metadataUnavailable === true || row.metadata === null) && isUserFacingSession({ ...row, metadataUnavailable: false })));
    const complete = currentState === 'exhausted' && archiveState === 'exhausted' && !unreadable;
    const textStyle = { color: paint.ink, fontSize: terminal ? 13 : 13.5 };
    const note = { color: paint.mute, fontSize: terminal ? 12 : 12.5 };
    const rowView = (row: { id: string; title: string }) => <SheetButton key={row.id} id={`ip-sessions-row-${row.id}`}
        label={t('ignorePrevious.sessions.openSession', { title: `${row.title}, ${rowContexts.get(row.id)}` })} onPress={() => openSession(row.id)}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <DeskText style={{ ...textStyle, flex: 1, minWidth: 0 }} numberOfLines={1} ellipsizeMode="tail">{row.title}</DeskText>
            <DeskText style={{ ...note, flexShrink: 1, maxWidth: '60%' }} numberOfLines={1} ellipsizeMode="tail">{rowContexts.get(row.id)}</DeskText>
            <Icon name="terminal" size={16} color={paint.bot} />
        </View>
    </SheetButton>;

    return <View ref={contentRef} testID="ip-sessions-sheet" accessibilityLabel={t('ignorePrevious.topBar.sessions')}
        style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 460, maxWidth: '100%', zIndex: 30,
            backgroundColor: paint.panel, borderWidth: 1, borderColor: paint.rule, borderRadius: terminal ? 2 : 12 }}>
        <View style={{ paddingHorizontal: 16, paddingVertical: 10, gap: 10, borderBottomWidth: 1, borderBottomColor: paint.rule }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <DeskText accessibilityRole="header" style={{ color: paint.ink, fontSize: terminal ? 14 : 21, flex: 1 }}>{terminal ? '# ' : ''}{t('ignorePrevious.topBar.sessions')}</DeskText>
                <SheetButton id="ip-sessions-close" label={t('common.close')} onPress={onClose}><DeskText style={textStyle}>{t('common.close')}</DeskText></SheetButton>
            </View>
            <TextInput testID="ip-sessions-search" accessibilityLabel={t('ignorePrevious.topBar.search')} placeholder={t('ignorePrevious.sessions.search')}
                autoFocus autoCapitalize="none" autoCorrect={false} editable={ready} value={search} onChangeText={setSearch}
                onFocus={() => setSearchFocused(true)} onBlur={() => setSearchFocused(false)}
                placeholderTextColor={paint.mute} style={{ fontFamily: DESK_FONT_STACK, ...textStyle, backgroundColor: paint.bg,
                    borderWidth: 1, borderColor: searchFocused ? paint.bot : paint.rule, borderRadius: terminal ? 2 : 8, padding: 8, minHeight: 44 }} />
        </View>
        <ScrollView style={{ flex: 1, minHeight: 0 }} contentContainerStyle={{ padding: 16, gap: 14 }} keyboardShouldPersistTaps="handled">
            {!ready ? <DeskText testID="ip-sessions-scope-pending" accessibilityLiveRegion="polite" style={note}>{t('ignorePrevious.sessions.scopePending')}</DeskText> : <>
                {entries.map(group => <View key={group.title} style={{ gap: 4 }}>
                    <DeskText accessibilityRole="header" style={note}>{group.title}</DeskText>
                    {group.rows.map(rowView)}
                </View>)}
                {!query && current.list.length === 0 && <DeskText testID="ip-sessions-current-empty" style={note}>{t('ignorePrevious.sessions.currentEmpty')}</DeskText>}
                {(showArchived || query) && <View testID="ip-sessions-archived" style={{ gap: 4 }}>
                    <DeskText accessibilityRole="header" style={note}>{t('ignorePrevious.sessions.archived')}</DeskText>
                    {archivedRows.map(rowView)}
                    {!query && archiveState === 'exhausted' && !unreadable && readableArchives.length === 0 && <DeskText style={note}>{t('ignorePrevious.sessions.archiveEmpty')}</DeskText>}
                </View>}
                {unreadable && <DeskText testID="ip-sessions-unreadable" accessibilityLiveRegion="polite" style={note}>{t('ignorePrevious.sessions.unreadable')}</DeskText>}
                {pending && <DeskText testID="ip-sessions-archive-loading" accessibilityLiveRegion="polite" style={note}>{t('ignorePrevious.sessions.loading')}</DeskText>}
                {(archiveState === 'error' || archiveState === 'unavailable') && <View testID="ip-sessions-archive-error" style={{ gap: 8 }}>
                    {archiveState === 'error' && <DeskText accessibilityLiveRegion="polite" style={note}>{t('ignorePrevious.sessions.archiveError')}</DeskText>}
                    <SheetButton id="ip-sessions-retry-archived" onPress={() => void loadArchives(archivePaging.retry !== 'append')}><DeskText style={textStyle}>{t('common.retry')}</DeskText></SheetButton>
                </View>}
                {currentState === 'error' && <DeskText testID="ip-sessions-current-error" accessibilityLiveRegion="polite" style={note}>{t('ignorePrevious.sessions.currentError')}</DeskText>}
                {query && !pending && query === settledQuery && complete && !hasMatches
                    && <DeskText testID="ip-sessions-no-matches" accessibilityLiveRegion="polite" style={note}>{t('ignorePrevious.sessions.noMatches')}</DeskText>}
                {query && !complete && <DeskText testID="ip-sessions-search-partial" accessibilityLiveRegion="polite" style={note}>{t('ignorePrevious.sessions.partial')}</DeskText>}
                <View style={{ borderTopWidth: 1, borderTopColor: paint.rule, paddingTop: 10, gap: 8 }}>
                    {!query && <SheetButton id="ip-sessions-toggle-archived" onPress={() => setShowArchived(value => !value)}><DeskText style={textStyle}>{t(showArchived ? 'ignorePrevious.sessions.hideArchived' : 'ignorePrevious.sessions.archived')}</DeskText></SheetButton>}
                    {!fixture && <>
                        <DeskText testID="ip-sessions-scope-note" style={note}>{t('ignorePrevious.sessions.scopeNote')}</DeskText>
                        {archiveState === 'more' && <SheetButton id="ip-sessions-load-archived" disabled={pending} onPress={() => { setShowArchived(true); void loadArchives(false); }}><DeskText style={textStyle}>{t('ignorePrevious.sessions.loadArchived')}</DeskText></SheetButton>}
                        {(currentState === 'more' || currentState === 'error' || currentState === 'unavailable' || unresolvedIssueRows.length > 0) && <SheetButton id="ip-sessions-load-current" disabled={pending} onPress={() => void loadCurrent(currentState !== 'more' && currentPaging.retry !== 'append')}><DeskText style={textStyle}>{t(currentState === 'more' ? 'ignorePrevious.sessions.loadCurrent' : 'common.retry')}</DeskText></SheetButton>}
                    </>}
                </View>
            </>}
        </ScrollView>
    </View>;
}
