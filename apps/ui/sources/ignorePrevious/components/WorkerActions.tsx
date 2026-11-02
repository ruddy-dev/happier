import * as React from 'react';
import { Pressable, View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { resolveAgentIdFromSessionMetadata } from '@happier-dev/agents';

import { DEFAULT_AGENT_ID, resolveAgentIdFromFlavor } from '@/agents/catalog/catalog';
import { createSessionActionTarget } from '@/components/sessions/actions/sessionActionContext';
import { useSessionMachineReachability } from '@/components/sessions/model/useSessionMachineReachability';
import { Text } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';
import { useNavigateToSession } from '@/hooks/session/useNavigateToSession';
import { useHappyAction } from '@/hooks/ui/useHappyAction';
import { applyPermissionModeSelection } from '@/sync/domains/permissions/permissionModeApply';
import { getPermissionModeOptionsForSession, normalizePermissionModeForAgentType } from '@/sync/domains/permissions/permissionModeOptions';
import type { PermissionMode } from '@/sync/domains/permissions/permissionTypes';
import type { Session } from '@/sync/domains/state/storageTypes';
import { storage, useSession, useSetting, useSettings } from '@/sync/domains/state/storage';
import { useSocketStatus } from '@/sync/store/hooks';
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
    accessibilityHint,
}: {
    testID: string;
    label: string;
    accessibilityLabel?: string;
    onPress: () => void;
    disabled?: boolean;
    accessibilityHint?: string;
}) {
    const { theme } = useUnistyles();
    return (
        <Pressable
            testID={testID}
            accessibilityRole="button"
            accessibilityLabel={accessibilityLabel ?? label}
            accessibilityHint={accessibilityHint}
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
function PermissionModeControl({ sessionId, mode, metadata, canChange }: { sessionId: string; mode: string; metadata: Session['metadata'] | null; canChange: boolean }) {
    const { theme } = useUnistyles();
    const applyTiming = useSetting('sessionPermissionModeApplyTiming');
    const [open, setOpen] = React.useState(false);

    // A stored alias such as 'plan' is marked as the option it means, as in the composer.
    const { options, selected } = React.useMemo(() => {
        if (!open) return { options: [], selected: null };
        const agentId = resolveAgentIdFromSessionMetadata(metadata) ?? resolveAgentIdFromFlavor(metadata?.flavor) ?? DEFAULT_AGENT_ID;
        return {
            options: getPermissionModeOptionsForSession(agentId, metadata),
            selected: normalizePermissionModeForAgentType(mode as PermissionMode, agentId),
        };
    }, [open, metadata, mode]);

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
                accessibilityValue={{ text: mode }}
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
                            accessibilityState={{ selected: option.value === selected }}
                            onPress={() => choose(option.value)}
                            style={{
                                paddingHorizontal: 8,
                                paddingVertical: 4,
                                borderRadius: 8,
                                backgroundColor: option.value === selected ? theme.colors.surface.inset : 'transparent',
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
    const { status } = useSocketStatus();
    const disconnected = status !== 'connected';
    const [stopping, stop] = useHappyAction(async () => {
        if (storage.getState().socketStatus !== 'connected') return;
        await sessionAbort(sessionId);
    });
    return (
        <RowButton
            testID={`ip-stop-${sessionId}`}
            label={t('ignorePrevious.stopTurn')}
            accessibilityLabel={t('ignorePrevious.stopTurnLabel')}
            onPress={() => void stop()}
            disabled={stopping || disconnected}
            accessibilityHint={disconnected ? t('ignorePrevious.connection.actionsUnavailable') : undefined}
        />
    );
}

/**
 * An inactive worker. Its own session view does the resuming, so this opens it; when the machine
 * is offline it says so instead. Whether it can be resumed at all is the session actions' rule
 * (`canResume`), the one the session header menu uses; otherwise it is a plain open.
 */
function ResumeControl({ sessionId, canResume }: { sessionId: string; canResume: boolean }) {
    const { theme } = useUnistyles();
    const { machineReachable } = useSessionMachineReachability(sessionId);
    const navigateToSession = useNavigateToSession();

    if (!canResume) {
        return (
            <RowButton
                testID={`ip-open-${sessionId}`}
                label={t('ignorePrevious.openSession')}
                accessibilityLabel={t('ignorePrevious.openWorker')}
                onPress={() => void navigateToSession(sessionId)}
            />
        );
    }
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
    const session = useSession(worker.sessionId);
    const settings = useSettings();
    const canResume = React.useMemo(
        () => (session && worker.inactive
            ? createSessionActionTarget({ session, resumeCapabilityOptions: { accountSettings: settings } }).canResume
            : false),
        [session, settings, worker.inactive],
    );
    // Write access as SessionView decides it: a session you can only view shows its mode and nothing to press.
    const canWrite = Boolean(session) && (!session?.accessLevel || session.accessLevel === 'edit' || session.accessLevel === 'admin');
    const canStop = Boolean(worker.canStop) && canWrite;
    if (!worker.permissionMode && !canStop && !worker.inactive) return null;
    return (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, paddingLeft: 18 }}>
            {worker.permissionMode ? (
                <PermissionModeControl sessionId={worker.sessionId} mode={worker.permissionMode} metadata={session?.metadata ?? null} canChange={canWrite} />
            ) : null}
            {canStop ? <StopControl sessionId={worker.sessionId} /> : null}
            {worker.inactive ? <ResumeControl sessionId={worker.sessionId} canResume={canResume} /> : null}
        </View>
    );
}
