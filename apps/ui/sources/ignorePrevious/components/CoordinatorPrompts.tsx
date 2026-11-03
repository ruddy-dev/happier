import * as React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';

import { Modal } from '@/modal';
import { readComposerText, requestComposerText } from '@/components/sessions/model/composerRequests';
import { t } from '@/text';

import { readDeskWaits, useDeskWaitsSummary, type DeskWaits } from '../model/useDeskWaits';
import { DeskText } from '../typography/DeskText';

/** The waiting list as the coordinator reads it: what each request runs, not only the agent's description. */
function waitingList({ items, unloaded }: DeskWaits): string {
    const lines: string[] = [];
    let n = 0;
    for (const item of items) {
        n += 1;
        const who = { n, session: item.sessionTitle, id: item.sessionId };
        if (item.kind === 'user_action') {
            lines.push(t('ignorePrevious.walkItemQuestion', who));
            continue;
        }
        lines.push(t('ignorePrevious.walkItem', { ...who, tool: item.tool, summary: item.summary }));
        if (item.agentNote) lines.push(t('ignorePrevious.walkItemNote', { note: item.agentNote }));
    }
    for (const wait of unloaded) {
        n += 1;
        const who = { n, session: wait.sessionTitle, id: wait.sessionId };
        lines.push(wait.reason === 'unreadable' ? t('ignorePrevious.walkItemUnreadable', who) : t('ignorePrevious.walkItemUnloaded', who));
    }
    return lines.join('\n');
}

/**
 * Unsent prompt drafts above the coordinator's chat. "Go through what's waiting" hands it the list from
 * Your turn into the composer; the user sends it and still presses Allow or Deny themselves.
 */
export function CoordinatorPrompts({ coordinatorId, phone = false }: { coordinatorId: string; phone?: boolean }) {
    const { theme } = useUnistyles();
    const { count } = useDeskWaitsSummary(coordinatorId);
    // A chip never wipes what is already typed: the prompt goes after the draft, a blank line apart.
    const fill = (text: string) => {
        const draft = (readComposerText(coordinatorId) ?? '').trimEnd();
        if (!requestComposerText(coordinatorId, draft.trim() ? `${draft}\n\n${text}` : text, { focus: true })) {
            Modal.alert(t('ignorePrevious.composer.unavailableTitle'), t('ignorePrevious.composer.unavailable'));
        }
    };

    const chip = (testID: string, label: string, onPress: () => void) => (
        <Pressable
            testID={testID}
            accessibilityRole="button"
            onPress={onPress}
            style={{
                flexShrink: 0,
                paddingHorizontal: 10,
                paddingVertical: 6,
                borderRadius: 10,
                borderWidth: 1,
                borderColor: theme.colors.border.default,
                backgroundColor: theme.colors.surface.inset,
            }}
        >
            <DeskText style={{ color: theme.colors.text.primary, fontSize: 13, fontWeight: '600' }}>{label}</DeskText>
        </Pressable>
    );

    const contents = <>
            {chip('ip-brief-first', t('ignorePrevious.composer.briefFirst'), () => fill(t('ignorePrevious.composer.briefPrompt')))}
            {chip('ip-start-new', t('ignorePrevious.composer.startNew'), () => fill(t('ignorePrevious.composer.startPrompt')))}
            {count > 0 ? chip('ip-walk-waiting', t('ignorePrevious.walkWaiting', { count }), () => fill(t('ignorePrevious.walkWaitingPrompt', { list: waitingList(readDeskWaits(coordinatorId)) }))) : null}
            {chip('ip-walk-prs', t('ignorePrevious.walkPrs'), () => fill(t('ignorePrevious.walkPrsPrompt')))}
        </>;
    if (phone) return <ScrollView testID="ip-phone-shortcuts" horizontal style={{ flexGrow: 0, minWidth: 0, maxWidth: '100%' }} contentContainerStyle={{ flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingBottom: 8 }}>{contents}</ScrollView>;
    return (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 12, paddingBottom: 8 }}>
            {contents}
        </View>
    );
}
