import * as React from 'react';
import { Pressable, View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';

import { Text } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';
import { Modal } from '@/modal';
import { sync } from '@/sync/sync';
import { t } from '@/text';

import { useDeskWaits, type DeskWaits } from '../model/useDeskWaits';

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
 * Quick prompts above the coordinator's chat. "Go through what's waiting" hands it the list from
 * Your turn so it can rate each request; you still press Allow or Deny yourself.
 */
export function CoordinatorPrompts({ coordinatorId }: { coordinatorId: string }) {
    const { theme } = useUnistyles();
    const waits = useDeskWaits(coordinatorId);
    const { count } = waits;
    const [sending, setSending] = React.useState(false);

    const send = React.useCallback(
        async (text: string, displayText: string) => {
            setSending(true);
            try {
                await sync.submitMessage(coordinatorId, text, displayText);
            } catch {
                Modal.alert(t('ignorePrevious.sendFailedTitle'), t('ignorePrevious.sendFailed'));
            } finally {
                setSending(false);
            }
        },
        [coordinatorId],
    );

    const chip = (testID: string, label: string, onPress: () => void) => (
        <Pressable
            testID={testID}
            accessibilityRole="button"
            accessibilityState={{ disabled: sending }}
            disabled={sending}
            onPress={onPress}
            style={{
                paddingHorizontal: 10,
                paddingVertical: 6,
                borderRadius: 10,
                borderWidth: 1,
                borderColor: theme.colors.border.default,
                backgroundColor: theme.colors.surface.inset,
                opacity: sending ? 0.6 : 1,
            }}
        >
            <Text style={{ color: theme.colors.text.primary, fontSize: 13, ...Typography.default('semiBold') }}>{label}</Text>
        </Pressable>
    );

    return (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 12, paddingBottom: 8 }}>
            {count > 0
                ? chip('ip-walk-waiting', t('ignorePrevious.walkWaiting', { count }), () =>
                      void send(t('ignorePrevious.walkWaitingPrompt', { list: waitingList(waits) }), t('ignorePrevious.walkWaitingShown')),
                  )
                : null}
            {chip('ip-walk-prs', t('ignorePrevious.walkPrs'), () => void send(t('ignorePrevious.walkPrsPrompt'), t('ignorePrevious.walkPrs')))}
        </View>
    );
}
