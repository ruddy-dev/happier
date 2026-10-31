import * as React from 'react';
import { Pressable, View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { resolveAgentIdFromSessionMetadata } from '@happier-dev/agents';

import { DEFAULT_AGENT_ID, resolveAgentIdFromFlavor } from '@/agents/catalog/catalog';
import { useSessionMachineReachability } from '@/components/sessions/model/useSessionMachineReachability';
import { Text } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';
import { useNavigateToSession } from '@/hooks/session/useNavigateToSession';
import { useHappyAction } from '@/hooks/ui/useHappyAction';
import { applyPermissionModeSelection } from '@/sync/domains/permissions/permissionModeApply';
import { getPermissionModeOptionsForSession } from '@/sync/domains/permissions/permissionModeOptions';
import type { PermissionMode } from '@/sync/domains/permissions/permissionTypes';
import { storage, useSession, useSetting } from '@/sync/domains/state/storage';
import { sessionAbort } from '@/sync/ops';
import { sync } from '@/sync/sync';
import { t } from '@/text';
import { fireAndForget } from '@/utils/system/fireAndForget';

import type { WorkerRow } from '../model/groupWorkers';

/** The small bordered button the worker row uses for its actions. */
function RowButton({
    testID,
    label,
    accessibilityLabel,
    onPress,
    disabled,
}: {
    testID: string;
    label: string;
    accessibilityLabel?: string;
    onPress: () => void;
    disabled?: boolean;
}) {
    const { theme } = useUnistyles();
    return (
        <Pressable
            testID={testID}
            accessibilityRole="button"
            accessibilityLabel={accessibilityLabel ?? label}
            accessibilityState={{ disabled: Boolean(disabled) }}
            disabled={disabled}
            onPress={onPress}
            style={{
                paddingHorizontal: 8,
                paddingVertical: 4,
                borderRadius: 8,
                borderWidth: 1,
                borderColor: theme.colors.border.default,
                opacity: disabled ? 0.5 : 1,
            }}
        >
            <Text style={{ color: theme.colors.text.primary, fontSize: 13 }}>{label}</Text>
        </Pressable>
    );
}

/**
 * The worker's permission mode. With write access it opens the agent's modes; choosing one goes
 * through `applyPermissionModeSelection`, the same path the session composer uses.
 */
function PermissionModeControl({ sessionId, mode }: { sessionId: string; mode: string }) {
    const { theme } = useUnistyles();
    const session = useSession(sessionId);
    const applyTiming = useSetting('sessionPermissionModeApplyTiming');
    const [open, setOpen] = React.useState(false);

    const metadata = session?.metadata ?? null;
    const canChange = Boolean(session) && (!session?.accessLevel || session.accessLevel === 'edit' || session.accessLevel === 'admin');
    const options = React.useMemo(() => {
        if (!open) return [];
        const agentId = resolveAgentIdFromSessionMetadata(metadata) ?? resolveAgentIdFromFlavor(metadata?.flavor) ?? DEFAULT_AGENT_ID;
        return getPermissionModeOptionsForSession(agentId, metadata);
    }, [open, metadata]);

    const choose = React.useCallback(
        (next: PermissionMode) => {
            setOpen(false);
            fireAndForget(
                applyPermissionModeSelection({
                    sessionId,
                    mode: next,
                    applyTiming: applyTiming === 'next_prompt' ? 'next_prompt' : 'immediate',
                    updateSessionPermissionMode: (sid, m) => storage.getState().updateSessionPermissionMode(sid, m),
                    getSessionPermissionModeUpdatedAt: (sid) => storage.getState().sessions[sid]?.permissionModeUpdatedAt ?? null,
                    publishSessionPermissionModeToMetadata: (payload) => sync.publishSessionPermissionModeToMetadata(payload),
                }),
                { tag: 'IgnorePrevious.WorkerActions.permissionMode' },
            );
        },
        [applyTiming, sessionId],
    );

    const chip = (
        <Text
            style={{
                color: theme.colors.text.secondary,
                fontSize: 13,
                ...Typography.mono(),
                paddingHorizontal: 6,
                paddingVertical: 2,
                borderRadius: 6,
                backgroundColor: theme.colors.surface.inset,
            }}
        >
            {mode}
        </Text>
    );

    if (!canChange) return chip;

    return (
        <View style={{ gap: 6 }}>
            <Pressable
                testID={`ip-mode-${sessionId}`}
                accessibilityRole="button"
                accessibilityLabel={t('ignorePrevious.changeMode')}
                accessibilityState={{ expanded: open }}
                onPress={() => setOpen((value) => !value)}
            >
                {chip}
            </Pressable>
            {open ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                    {options.map((option) => (
                        <Pressable
                            key={option.value}
                            testID={`ip-mode-option-${sessionId}-${option.value}`}
                            accessibilityRole="button"
                            accessibilityState={{ selected: option.value === mode }}
                            onPress={() => choose(option.value)}
                            style={{
                                paddingHorizontal: 8,
                                paddingVertical: 4,
                                borderRadius: 8,
                                backgroundColor: option.value === mode ? theme.colors.surface.inset : 'transparent',
                                borderWidth: 1,
                                borderColor: theme.colors.border.default,
                            }}
                        >
                            <Text style={{ color: theme.colors.text.primary, fontSize: 13 }}>{option.label}</Text>
                        </Pressable>
                    ))}
                </View>
            ) : null}
        </View>
    );
}

function StopControl({ sessionId }: { sessionId: string }) {
    const [stopping, stop] = useHappyAction(() => sessionAbort(sessionId));
    return (
        <RowButton
            testID={`ip-stop-${sessionId}`}
            label={t('ignorePrevious.stopTurn')}
            accessibilityLabel={t('ignorePrevious.stopTurnLabel')}
            onPress={() => void stop()}
            disabled={stopping}
        />
    );
}

/**
 * An inactive worker. Its own session view does the resuming, so this opens it; when the machine
 * is offline it says so instead.
 */
function ResumeControl({ sessionId }: { sessionId: string }) {
    const { theme } = useUnistyles();
    const { machineReachable } = useSessionMachineReachability(sessionId);
    const navigateToSession = useNavigateToSession();

    if (!machineReachable) {
        return (
            <Text testID={`ip-offline-${sessionId}`} style={{ color: theme.colors.text.secondary, fontSize: 13 }}>
                {t('session.machineOfflineNoticeTitle')}
            </Text>
        );
    }
    return (
        <RowButton
            testID={`ip-resume-${sessionId}`}
            label={t('ignorePrevious.openToResume')}
            accessibilityLabel={t('ignorePrevious.openToResumeLabel')}
            onPress={() => void navigateToSession(sessionId)}
        />
    );
}

/** What you can do to one worker from the desk: change its mode, stop its turn, or open it to resume. */
export function WorkerActions({ worker }: { worker: WorkerRow }) {
    if (!worker.permissionMode && !worker.canStop && !worker.inactive) return null;
    return (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, paddingLeft: 18 }}>
            {worker.permissionMode ? <PermissionModeControl sessionId={worker.sessionId} mode={worker.permissionMode} /> : null}
            {worker.canStop ? <StopControl sessionId={worker.sessionId} /> : null}
            {worker.inactive ? <ResumeControl sessionId={worker.sessionId} /> : null}
        </View>
    );
}
