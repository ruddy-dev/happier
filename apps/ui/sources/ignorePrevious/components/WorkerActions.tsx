import * as React from 'react';
import { Pressable, View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { resolveAgentIdFromSessionMetadata } from '@happier-dev/agents';

import { DEFAULT_AGENT_ID, resolveAgentIdFromFlavor } from '@/agents/catalog/catalog';
import { createSessionActionTarget } from '@/components/sessions/actions/sessionActionContext';
import { useSessionMachineTarget } from '@/components/sessions/model/useSessionMachineTarget';
import { resolveSessionMachineReachability } from '@/components/sessions/model/resolveSessionMachineReachability';
import { resolveSessionMachineId } from '@/sync/domains/session/directSessions/resolveSessionMachineId';
import { isMachineOnline } from '@/utils/sessions/machineUtils';
import { listPendingPermissionRequests } from '@/utils/sessions/sessionUtils';
import { deriveTranscriptInteraction } from '@/utils/sessions/deriveTranscriptInteraction';
import { useDeskNow } from '../model/useDeskNow';
import { workerPermissionMode, requestsApprovedAfterModeChange, type ModeChangeRequests } from '../model/workerPermissionMode';
import { DeskText as Text } from '../typography/DeskText';
import { Typography } from '@/constants/Typography';
import { useNavigateToSession } from '@/hooks/session/useNavigateToSession';
import { useHappyAction } from '@/hooks/ui/useHappyAction';
import { applyPermissionModeSelection } from '@/sync/domains/permissions/permissionModeApply';
import { getPermissionModeOptionsForSession, normalizePermissionModeForAgentType } from '@/sync/domains/permissions/permissionModeOptions';
import type { PermissionMode } from '@/sync/domains/permissions/permissionTypes';
import type { Session } from '@/sync/domains/state/storageTypes';
import { storage, useSession, useSetting, useSettings } from '@/sync/domains/state/storage';
import { useSocketStatus } from '@/sync/store/hooks';
import { sessionAbortResult, type SessionAbortResult } from '@/sync/ops';
import { sync } from '@/sync/sync';
import { t } from '@/text';

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
function PermissionModeControl({ session, canChange }: { session: Session; canChange: boolean }) {
    const sessionId = session.id;
    const metadata = session.metadata;
    const mode = session.permissionMode ?? 'default';
    const presentation = workerPermissionMode(session);
    const [failed, setFailed] = React.useState(false);
    const [change, setChange] = React.useState<ModeChangeRequests | null>(null);
    const cleared = requestsApprovedAfterModeChange(session, change);
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

    const selection = React.useRef<PermissionMode>('default');
    const [applying, apply] = useHappyAction(async () => {
        const next = selection.current;
        setOpen(false);
        setFailed(false);
        const current = storage.getState().sessions[sessionId];
        setChange({ mode: next, requests: current ? listPendingPermissionRequests(current) : [] });
        try {
            await applyPermissionModeSelection({
                sessionId,
                mode: next,
                applyTiming: applyTiming === 'next_prompt' ? 'next_prompt' : 'immediate',
                updateSessionPermissionMode: (sid, m) => storage.getState().updateSessionPermissionMode(sid, m),
                getSessionPermissionModeUpdatedAt: (sid) => storage.getState().sessions[sid]?.permissionModeUpdatedAt ?? null,
                publishSessionPermissionModeToMetadata: (payload) => sync.publishSessionPermissionModeToMetadata(payload),
            });
        } catch (error) {
            setFailed(true);
            throw error;
        }
    });
    const pendingText = presentation.pending ? (failed
        ? t('ignorePrevious.workerControl.modeNotSent', { mode: presentation.pending })
        : applyTiming === 'next_prompt'
            ? t('ignorePrevious.workerControl.modeNextPrompt', { mode: presentation.pending })
            : t('ignorePrevious.workerControl.modePending', { mode: presentation.pending })) : null;

    const chip = (
        <Text
            testID={`ip-mode-current-${sessionId}`}
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
            {presentation.current ? t('ignorePrevious.workerControl.modePublished', { mode: presentation.current }) : t('ignorePrevious.workerControl.modeUnknown')}
        </Text>
    );

    const note = <>
        {pendingText ? <Text testID={`ip-mode-pending-${sessionId}`} accessibilityLiveRegion="polite" style={{ color: theme.colors.text.secondary }}>{pendingText}</Text> : null}
        {cleared.length ? <Text testID={`ip-mode-cleared-${sessionId}`} accessibilityLiveRegion="polite" style={{ color: theme.colors.text.secondary }}>
            {t('ignorePrevious.workerControl.modeCleared', { requests: cleared.join('; ') })}
        </Text> : null}
    </>;
    if (!canChange) return <View>{chip}{note}</View>;

    return (
        <View style={{ gap: 6 }}>
            <Pressable
                testID={`ip-mode-${sessionId}`}
                accessibilityRole="button"
                accessibilityLabel={t('ignorePrevious.changeMode')}
                accessibilityValue={{ text: [presentation.current ? t('ignorePrevious.workerControl.modePublished', { mode: presentation.current }) : t('ignorePrevious.workerControl.modeUnknown'), pendingText].filter(Boolean).join('. ') }}
                accessibilityState={{ expanded: open, disabled: applying }}
                disabled={applying}
                onPress={() => setOpen((value) => !value)}
            >
                {chip}
            </Pressable>
            {note}
            {open ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                    {options.map((option) => (
                        <Pressable
                            key={option.value}
                            testID={`ip-mode-option-${sessionId}-${option.value}`}
                            accessibilityRole="button"
                            accessibilityState={{ selected: option.value === selected }}
                            onPress={() => { selection.current = option.value; void apply(); }}
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
    const { theme } = useUnistyles();
    const [failure, setFailure] = React.useState<Extract<SessionAbortResult, { ok: false }>['reason'] | null>(null);
    const [stopping, stop] = useHappyAction(async () => {
        if (storage.getState().socketStatus !== 'connected') return;
        setFailure(null);
        const result = await sessionAbortResult(sessionId);
        if (!result.ok) setFailure(result.reason);
    });
    return (
        <View style={{ gap: 6 }}>
        <RowButton
            testID={`ip-stop-${sessionId}`}
            label={t('ignorePrevious.stopTurn')}
            accessibilityLabel={t('ignorePrevious.stopTurnLabel')}
            onPress={() => void stop()}
            disabled={stopping || disconnected}
            accessibilityHint={disconnected ? t('ignorePrevious.connection.actionsUnavailable') : undefined}
        />
        {failure ? <Text testID={`ip-stop-error-${sessionId}`} accessibilityLiveRegion="polite" style={{ color: theme.colors.text.secondary }}>
            {failure === 'not_listening' ? t('ignorePrevious.workerControl.stopNotListening')
                : failure === 'rejected' ? t('ignorePrevious.workerControl.stopRejected')
                    : t('ignorePrevious.workerControl.stopEncryptionUnavailable')}
        </Text> : null}
        </View>
    );
}

/**
 * An inactive worker. Its own session view does the resuming, so this opens it; when the machine
 * is offline it says so instead. Whether it can be resumed at all is the session actions' rule
 * (`canResume`), the one the session header menu uses; otherwise it is a plain open.
 */
function ResumeControl({ sessionId, canResume }: { sessionId: string; canResume: boolean }) {
    const { theme } = useUnistyles();
    const target = useSessionMachineTarget(sessionId);
    const originId = storage((state) => resolveSessionMachineId(state.sessions[sessionId]?.metadata));
    // An unusable RPC target must not turn a known revoked/replaced machine into "unknown".
    const machine = storage((state) => state.machines[target?.machineId ?? originId ?? ''] ?? null);
    const nowMs = useDeskNow();
    const machineReachable = resolveSessionMachineReachability({ machineIsKnown: Boolean(machine), machineIsOnline: machine ? isMachineOnline(machine, nowMs) : false });
    const navigateToSession = useNavigateToSession();

    return (
        <View style={{ gap: 6 }}>
            {!machineReachable ? (
                <Text testID={`ip-offline-${sessionId}`} style={{ color: theme.colors.text.secondary, fontSize: 13 }}>
                    {t('ignorePrevious.workerControl.machineOffline')}
                </Text>
            ) : null}
            {machineReachable || !canResume ? (
                <RowButton
                    testID={`${canResume ? 'ip-resume' : 'ip-open'}-${sessionId}`}
                    label={canResume ? t('ignorePrevious.openToResume') : t('ignorePrevious.openSession')}
                    accessibilityLabel={canResume ? t('ignorePrevious.openToResumeLabel') : t('ignorePrevious.openWorker')}
                    onPress={() => void navigateToSession(sessionId)}
                />
            ) : null}
        </View>
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
    const canWrite = Boolean(session) && deriveTranscriptInteraction({ kind: 'session', accessLevel: session?.accessLevel, canApprovePermissions: session?.canApprovePermissions }).canSendMessages;
    const canStop = Boolean(worker.canStop) && canWrite;
    if (!worker.permissionMode && !canStop && !worker.inactive) return null;
    return (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, paddingLeft: 18 }}>
            {worker.permissionMode && session ? (
                <PermissionModeControl session={session} canChange={canWrite} />
            ) : null}
            {canStop ? <StopControl sessionId={worker.sessionId} /> : null}
            {worker.inactive ? <ResumeControl sessionId={worker.sessionId} canResume={canResume} /> : null}
        </View>
    );
}
