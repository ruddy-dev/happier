import * as React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { TextInput } from '@/components/ui/text/Text';
import { Icon } from '@/components/ui/icons/Icon';
import { useRouter } from 'expo-router';
import { useUnistyles } from 'react-native-unistyles';
import { getSessionName } from '@/utils/sessions/sessionUtils';
import { t } from '@/text';
import { DESK_FONT_STACK } from '../fonts/deskFont';
import { useDeskSessions } from '../useDeskSessions';
import { useCoordinatorId } from '../model/useCoordinatorId';
import { useIssueKeys } from '../model/useIssueKeys';
import { groupWorkersByIssue } from '../model/groupWorkers';
import { useDeskNow } from '../model/useDeskNow';
import { useDeskPopup } from '../popups/useDeskPopup';
import { DeskText } from '../typography/DeskText';
import { toWorkerRows } from './WorkColumn';

export function SessionsSheet({ openerRef, onClose }: { openerRef: React.RefObject<View | null>; onClose: () => void }) {
    const { theme } = useUnistyles();
    const router = useRouter();
    const contentRef = React.useRef<View>(null);
    const [search, setSearch] = React.useState('');
    const desk = useDeskSessions();
    const coordinatorId = useCoordinatorId(desk.list);
    const workers = React.useMemo(() => ({ ...desk, list: desk.list.filter(row => row.id !== coordinatorId) }), [desk, coordinatorId]);
    const issueKeys = useIssueKeys(workers);
    const now = useDeskNow();
    const groups = React.useMemo(() => groupWorkersByIssue(toWorkerRows(workers.list, workers.lookup, issueKeys, now)), [workers, issueKeys, now]);
    useDeskPopup({ open: true, onClose, openerRef, contentRef, returnFocusOnClose: true });
    const query = search.trim().toLocaleLowerCase();
    const coordinator = desk.list.find(row => row.id === coordinatorId);
    const entries = [
        { title: t('ignorePrevious.topBar.coordinator'), rows: coordinator ? [{ id: coordinator.id, title: getSessionName(coordinator) }] : [] },
        { title: t('ignorePrevious.topBar.onIssues'), rows: groups.filter(g => g.issueKey !== null).flatMap(g => g.workers.map(w => ({ id: w.sessionId, title: `${g.issueKey} ${w.title}` }))) },
        { title: t('ignorePrevious.noIssue'), rows: groups.filter(g => g.issueKey === null).flatMap(g => g.workers.map(w => ({ id: w.sessionId, title: w.title }))) },
    ];
    return <View ref={contentRef} testID="ip-sessions-sheet" style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 390, maxWidth: '100%', zIndex: 30, backgroundColor: theme.colors.surface.base, borderRightWidth: 1, borderRightColor: theme.colors.border.default }}>
        <View style={{ padding: 16, gap: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <DeskText accessibilityRole="header" style={{ color: theme.colors.text.primary, fontSize: 18 }}>{t('ignorePrevious.topBar.sessions')}</DeskText>
                <Pressable testID="ip-sessions-close" accessibilityRole="button" accessibilityLabel={t('common.close')} onPress={onClose} hitSlop={8}
                    style={{ marginLeft: 'auto', padding: 6, minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 8 }}>
                    <Icon name="x" size={18} color={theme.colors.text.secondary} />
                </Pressable>
            </View>
            <TextInput testID="ip-sessions-search" accessibilityLabel={t('ignorePrevious.topBar.search')} placeholder={t('ignorePrevious.topBar.search')} value={search} onChangeText={setSearch} style={{ fontFamily: DESK_FONT_STACK, color: theme.colors.text.primary, borderWidth: 1, borderColor: theme.colors.border.default, padding: 8 }} />
        </View>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
            {entries.map(group => <View key={group.title} style={{ gap: 8 }}>
                <DeskText accessibilityRole="header" style={{ color: theme.colors.text.secondary }}>{group.title}</DeskText>
                {group.rows.filter(row => row.title.toLocaleLowerCase().includes(query)).map(row => <Pressable key={row.id} testID={`ip-sessions-row-${row.id}`} accessibilityRole="button" onPress={() => { onClose(); router.navigate(`/session/${row.id}`); }} style={{ paddingVertical: 8 }}><DeskText style={{ color: theme.colors.text.primary }} numberOfLines={1}>{row.title}</DeskText></Pressable>)}
            </View>)}
        </ScrollView>
    </View>;
}
