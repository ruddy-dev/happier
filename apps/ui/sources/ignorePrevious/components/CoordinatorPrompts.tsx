import * as React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';

import { Modal } from '@/modal';
import { readComposerText, requestComposerText } from '@/components/sessions/model/composerRequests';
import { t } from '@/text';

import { readDeskAttentionWaits, useDeskWaitsSummary, type DeskWaits } from '../model/useDeskWaits';
import { DeskText } from '../typography/DeskText';
import { usePhoneControlPaint } from './usePhoneControlPaint';

function PromptChip({ testID, label, onPress, phone }: { testID: string; label: string; onPress: () => void; phone: boolean }) {
    const { theme } = useUnistyles();
    const { terminal, paint } = usePhoneControlPaint();
    const [focused, setFocused] = React.useState(false);
    const styled = phone && terminal;
    return <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label} onPress={onPress}
        onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
        style={{ flexShrink: 0, minHeight: phone ? 48 : undefined, justifyContent: 'center', paddingHorizontal: 10,
            paddingVertical: 6, borderRadius: styled ? 0 : 10, borderWidth: phone && focused ? 2 : 1,
            borderColor: phone && focused ? paint.ink : styled ? paint.rule : theme.colors.border.default,
            backgroundColor: styled ? paint.panel2 : theme.colors.surface.inset }}>
        <DeskText style={{ color: styled ? paint.mute : theme.colors.text.primary, fontSize: 13, fontWeight: styled ? '500' : '600' }}>
            {styled ? `[ ${label} ]` : label}
        </DeskText>
    </Pressable>;
}

/** The waiting list as the coordinator reads it: what each request runs, not only the agent's description. */
function waitingList({ items, unloaded }: DeskWaits): string {
    const lines: string[] = [];
    let n = 0;
    for (const item of items) {
        n += 1;
        const who = { n, session: item.sessionTitle, id: item.sessionId };
        if (item.kind === 'user_action') {
            lines.push(t('ignorePrevious.walkItemQuestion', who));
            if (item.disabledReason === 'notGranted') lines.push(t('ignorePrevious.walkItemRestricted'));
            continue;
        }
        lines.push(t('ignorePrevious.walkItem', { ...who, tool: item.tool, summary: item.detail }));
        if (item.disabledReason === 'notGranted') lines.push(t('ignorePrevious.walkItemRestricted'));
        if (item.agentNote) lines.push(t('ignorePrevious.walkItemNote', { note: item.agentNote }));
    }
    for (const wait of unloaded) {
        n += 1;
        const who = { n, session: wait.sessionTitle, id: wait.sessionId };
        lines.push(wait.reason === 'unreadable' ? t('ignorePrevious.walkItemUnreadable', who) : t('ignorePrevious.walkItemUnloaded', who));
        if (wait.disabledReason === 'notGranted') lines.push(t('ignorePrevious.walkItemRestricted'));
    }
    return lines.join('\n');
}

/**
 * Unsent prompt drafts above the coordinator's chat. "Go through what's waiting" hands it the list from
 * Your turn into the composer; the user sends it and still presses Allow or Deny themselves.
 */
export function CoordinatorPrompts({ coordinatorId, phone = false }: { coordinatorId: string; phone?: boolean }) {
    const { count } = useDeskWaitsSummary(coordinatorId);
    // A chip never wipes what is already typed: the prompt goes after the draft, a blank line apart.
    const fill = (text: string) => {
        const draft = (readComposerText(coordinatorId) ?? '').trimEnd();
        if (!requestComposerText(coordinatorId, draft.trim() ? `${draft}\n\n${text}` : text, { focus: true })) {
            Modal.alert(t('ignorePrevious.composer.unavailableTitle'), t('ignorePrevious.composer.unavailable'));
        }
    };

    const chip = (testID: string, label: string, onPress: () => void) => (
        <PromptChip testID={testID} label={label} onPress={onPress} phone={phone} />
    );

    const contents = <>
            {chip('ip-brief-first', t('ignorePrevious.composer.briefFirst'), () => fill(t('ignorePrevious.composer.briefPrompt')))}
            {chip('ip-start-new', t('ignorePrevious.composer.startNew'), () => fill(t('ignorePrevious.composer.startPrompt')))}
            {count > 0 ? chip('ip-walk-waiting', t('ignorePrevious.walkWaiting', { count }), () => fill(t('ignorePrevious.walkWaitingPrompt', { list: waitingList(readDeskAttentionWaits(coordinatorId)) }))) : null}
            {chip('ip-walk-prs', t('ignorePrevious.walkPrs'), () => fill(t('ignorePrevious.walkPrsPrompt')))}
        </>;
    if (phone) return <ScrollView testID="ip-phone-shortcuts" horizontal keyboardShouldPersistTaps="handled" style={{ flexGrow: 0, minWidth: 0, maxWidth: '100%' }} contentContainerStyle={{ flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingBottom: 8 }}>{contents}</ScrollView>;
    return (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 12, paddingBottom: 8 }}>
            {contents}
        </View>
    );
}
