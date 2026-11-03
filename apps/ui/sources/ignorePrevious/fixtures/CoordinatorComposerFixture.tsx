/** Offline AgentInput states. Only the fixture body imports this module. */
import * as React from 'react';
import { Pressable, View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { AgentInput } from '@/components/sessions/agentInput/AgentInput';
import { useSessionComposerOverrides } from '@/components/sessions/model/sessionComposerOverrides';
import type { PermissionMode } from '@/sync/domains/permissions/permissionTypes';
import { storage } from '@/sync/domains/state/storage';
import { useSession } from '@/sync/store/hooks';
import { t } from '@/text';
import { DeskText } from '../typography/DeskText';
import { useDeskComposerControls } from '../model/useDeskComposerControls';
import { DeskDemoContext } from '../deskFixtureGate';
import scenario from './desk-fixture.json';

// Never bind these controls to sync, session operations, device capture or discovery.
const noAction = () => {};
const noSuggestions = async () => [];
const autocompleteKinds = [] as const;
const statusBadges = [] as const;
const states = [
    { id: 'idle', label: 'Idle Claude Plan' },
    { id: 'busy', label: 'Busy Codex' },
    { id: 'readonly', label: 'Read-only Codex' },
] as const;
type FixtureState = typeof states[number]['id'];

export function CoordinatorComposerFixture({ sessionId, footerLeadingActions, statusTrailingActions }: {
    sessionId: string; footerLeadingActions?: React.ReactNode; statusTrailingActions?: React.ReactNode;
}) {
    const { theme } = useUnistyles();
    const isDemo = React.useContext(DeskDemoContext);
    const isInspectionFixture = !isDemo && sessionId === scenario.coordinatorId;
    const session = useSession(sessionId);
    const originalAccess = React.useRef(session?.accessLevel);
    const [state, setState] = React.useState<FixtureState>('idle');
    const [draft, setDraft] = React.useState('');
    const [permissionMode, setPermissionMode] = React.useState<PermissionMode>('plan');
    const [modelMode, setModelMode] = React.useState('default');
    const controls = useDeskComposerControls(sessionId);
    const isReadOnly = session?.accessLevel === 'view';
    const agentType = state === 'idle' ? 'claude' : 'codex';
    const metadata = React.useMemo(() => session?.metadata ? {
        ...session.metadata, flavor: agentType, permissionMode,
    } : null, [session?.metadata, agentType, permissionMode]);
    const resolved = useSessionComposerOverrides({
        isReadOnly, placeholder: t(isReadOnly ? 'session.sharing.viewOnlyMode' : 'session.inputPlaceholder'),
        extraActionChips: undefined, statusBadges, providerUsageGauge: null,
        onMicPress: noAction, isMicActive: false, onAbort: noAction, alwaysShowContextSize: false,
    }, {
        ...controls, placeholder: t('ignorePrevious.composer.placeholder'),
        hide: { ...controls.hide, contextUsage: true }, providerUsageGauge: null,
        footerLeadingActions, statusTrailingActions,
    });
    const select = (next: FixtureState) => {
        // Demo playback owns its records; state selection belongs only to the inspection fixture.
        if (!isInspectionFixture) return;
        const current = storage.getState().sessions[sessionId];
        if (!current?.metadata) return;
        const now = Date.now();
        const mode = next === 'idle' ? 'plan' : 'safe-yolo';
        storage.getState().applySessions([{
            ...current, active: true, activeAt: now, thinking: next !== 'idle', thinkingAt: now,
            accessLevel: next === 'readonly' ? 'view' : originalAccess.current,
            metadata: { ...current.metadata, flavor: next === 'idle' ? 'claude' : 'codex', permissionMode: mode },
            metadataVersion: current.metadataVersion + 1,
        }]);
        setPermissionMode(mode);
        setModelMode('default');
        setState(next);
    };
    return <>
        {/* Dev-only fixture controls use plain English, like the fixture route's signed-out notice. */}
        {isInspectionFixture ? <View testID="ip-fixture-composer-states" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 12 }}>
            {states.map(option => <Pressable key={option.id} testID={`ip-fixture-composer-${option.id}`}
                accessibilityRole="button" accessibilityLabel={option.label} accessibilityState={{ selected: state === option.id }}
                onPress={() => select(option.id)}
                style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 }}>
                <DeskText style={{ color: theme.colors.text.secondary }}>{option.label}</DeskText>
            </Pressable>)}
        </View> : null}
        <AgentInput sessionId={sessionId} value={draft} onChangeText={setDraft}
            onSend={noAction} isSendDisabled={true} disabled={isReadOnly}
            agentType={agentType} metadata={metadata} permissionMode={permissionMode}
            onPermissionModeChange={isReadOnly ? undefined : setPermissionMode}
            onAcpSessionModeChange={isReadOnly ? undefined : noAction}
            modelMode={modelMode} onModelModeChange={isReadOnly ? undefined : setModelMode}
            canApprovePermissions={false} permissionDisabledReason={isReadOnly ? 'readOnly' : 'inactive'}
            onFileViewerPress={noAction} autocompleteKinds={autocompleteKinds} autocompleteSuggestions={noSuggestions}
            {...resolved} />
    </>;
}
