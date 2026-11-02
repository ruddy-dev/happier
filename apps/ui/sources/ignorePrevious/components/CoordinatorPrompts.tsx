import * as React from 'react';
import { Pressable, View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { shallow } from 'zustand/shallow';

import { Modal } from '@/modal';
import { readComposerText, requestComposerText } from '@/components/sessions/model/composerRequests';
import { t } from '@/text';
import { storage } from '@/sync/domains/state/storage';

import { resolveCoordinatorReplyChips } from '../model/coordinatorReplyChips';
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
export function CoordinatorPrompts({ coordinatorId }: { coordinatorId: string }) {
    const { theme } = useUnistyles();
    const { count } = useDeskWaitsSummary(coordinatorId);
    const selectReplies = React.useMemo(() => {
        let requests: NonNullable<ReturnType<typeof storage.getState>['sessions'][string]['agentState']>['requests'];
        let labels: readonly string[] = [];
        return (state: ReturnType<typeof storage.getState>) => {
            const next = state.sessions[coordinatorId]?.agentState?.requests;
            if (requests !== next) {
                const nextLabels = resolveCoordinatorReplyChips(next);
                if (!shallow(labels, nextLabels)) labels = nextLabels;
            }
            requests = next;
            return labels;
        };
    }, [coordinatorId]);
    const replies = storage(selectReplies);
    // A chip never wipes what is already typed: the prompt goes after the draft, a blank line apart.
    const fill = (text: string) => {
        const draft = (readComposerText(coordinatorId) ?? '').trimEnd();
        if (!requestComposerText(coordinatorId, draft.trim() ? `${draft}\n\n${text}` : text, { focus: true })) {
            Modal.alert(t('ignorePrevious.composer.unavailableTitle'), t('ignorePrevious.composer.unavailable'));
        }
    };

    const chip = (testID: string, label: string, onPress: () => void, accessibilityLabel?: string) => (
        <Pressable
            key={testID}
            testID={testID}
            accessibilityRole="button"
            accessibilityLabel={accessibilityLabel}
            onPress={onPress}
            style={{
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

    return (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 12, paddingBottom: 8 }}>
            {chip('ip-brief-first', t('ignorePrevious.composer.briefFirst'), () => fill(t('ignorePrevious.composer.briefPrompt')))}
            {chip('ip-start-new', t('ignorePrevious.composer.startNew'), () => fill(t('ignorePrevious.composer.startPrompt')))}
            {count > 0
                ? chip('ip-walk-waiting', t('ignorePrevious.walkWaiting', { count }), () =>
                      // Read the details only on press, so the closed chip keeps only the count subscription.
                      fill(t('ignorePrevious.walkWaitingPrompt', { list: waitingList(readDeskWaits(coordinatorId)) })),
                  )
                : null}
            {chip('ip-walk-prs', t('ignorePrevious.walkPrs'), () => fill(t('ignorePrevious.walkPrsPrompt')))}
            {replies.map((label, index) => chip(`ip-coordinator-reply-${index}`, label, () => fill(label),
                t('ignorePrevious.composer.questionReply', { label })))}
        </View>
    );
}
