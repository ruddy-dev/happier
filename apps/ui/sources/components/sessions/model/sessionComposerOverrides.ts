import * as React from 'react';

import type {
    AgentInputExtraActionChip,
    AgentInputStatusBadge,
} from '@/components/sessions/agentInput/agentInputContracts';
import type { ComposerTextStore } from '@/components/sessions/agentInput/composerTextStore';
import type { InSessionAgentPickerControls } from '@/components/sessions/agentPicker/useInSessionAgentPickerControls';
import type { SessionModelOptionsContext } from '@/sync/domains/models/modelOptions';
import type { AgentId } from '@/agents/catalog/catalog';
import type { ConnectedServiceQuotaGaugeViewModel } from '@/sync/domains/connectedServices/connectedServiceQuotaGauge';

export type SessionComposerHostControls = Readonly<{
    agentId: AgentId | null;
    modelId: string;
    configOverrides: Readonly<Record<string, string>>;
    machineId: string | null;
    serverId: string;
    cwd: string | null;
    canSend: boolean;
    textStore: ComposerTextStore;
    hasNonTextDraft: boolean;
    probeGeneration?: string;
    continuationNotice?: string | null;
    busy: boolean;
    switchingEnabled: boolean;
    agentPicker: InSessionAgentPickerControls;
    setModel: (modelId: string, context?: SessionModelOptionsContext) => void;
    setConfigOption: (configId: string, valueId: string) => void;
    /** The very same handler as AgentInput, with its ordinary send rules. */
    sendMessage: (text: string) => void;
}>;

/**
 * Optional composer customisation a host screen can pass to SessionView.
 * Omitted fields keep Happier's behaviour. Callers should memoise the object:
 * SessionView is React.memo.
 */
export type SessionViewComposerOverrides = Readonly<{
    placeholder?: string;
    /** Keep Stop in the Send position while the host's worker is busy, even with a draft. */
    sendIsStop?: boolean;
    /** Appended after Happier's chips. */
    extraActionChips?: ReadonlyArray<AgentInputExtraActionChip>;
    /** Appended after Happier's badges. */
    statusBadges?: ReadonlyArray<AgentInputStatusBadge>;
    statusTrailingActions?: React.ReactNode;
    /** Always visible at the start of the action footer, including collapsed layouts. */
    footerLeadingActions?: React.ReactNode;
    renderFooterLeadingActions?: (controls: SessionComposerHostControls) => React.ReactNode;
    /** undefined keeps Happier's gauge, null removes it, a view model replaces it. */
    providerUsageGauge?: ConnectedServiceQuotaGaugeViewModel | null;
    /** undefined keeps Happier's mic, null removes it, an object replaces it. */
    mic?: Readonly<{ onPress: () => void; isActive: boolean }> | null;
    hide?: Readonly<{ contextUsage?: boolean; stop?: boolean }>;
}>;

export type ComposerBase = Readonly<{
    isReadOnly: boolean;
    placeholder: string;
    /** SessionView passes undefined when it has no chips; that is kept as is. */
    extraActionChips: ReadonlyArray<AgentInputExtraActionChip> | undefined;
    statusBadges: ReadonlyArray<AgentInputStatusBadge>;
    providerUsageGauge: ConnectedServiceQuotaGaugeViewModel | null | undefined;
    onMicPress: (() => void) | undefined;
    isMicActive: boolean | undefined;
    onAbort: (() => void) | undefined;
    alwaysShowContextSize: boolean;
}>;

export type ResolvedComposer = Omit<ComposerBase, 'isReadOnly'> & Readonly<{
    statusTrailingActions: React.ReactNode;
    footerLeadingActions: React.ReactNode;
    hideContextUsage: boolean;
    sendIsStop: boolean;
    hideAbortButton: boolean;
}>;

function useAppended<Base extends ReadonlyArray<unknown> | undefined>(
    base: Base,
    extra: Base | undefined,
): Base {
    return React.useMemo(
        () => (extra && extra.length > 0 ? ([...(base ?? []), ...extra] as unknown as Base) : base),
        [base, extra],
    );
}

export function useSessionComposerOverrides(
    base: ComposerBase,
    overrides: SessionViewComposerOverrides | null | undefined,
    hostControls?: SessionComposerHostControls,
): ResolvedComposer {
    const extraActionChips = useAppended(base.extraActionChips, overrides?.extraActionChips);
    const statusBadges = useAppended(base.statusBadges, overrides?.statusBadges);

    const mic = overrides?.mic;
    const hideContextUsage = overrides?.hide?.contextUsage === true;
    const sendIsStop = !base.isReadOnly && overrides?.sendIsStop === true;

    return {
        // A view-only session keeps its own placeholder so the reader knows why typing is off.
        placeholder: base.isReadOnly ? base.placeholder : (overrides?.placeholder ?? base.placeholder),
        extraActionChips,
        statusBadges,
        statusTrailingActions: overrides?.statusTrailingActions,
        footerLeadingActions: hostControls && overrides?.renderFooterLeadingActions
            ? overrides.renderFooterLeadingActions(hostControls) : overrides?.footerLeadingActions,
        providerUsageGauge: overrides?.providerUsageGauge !== undefined ? overrides.providerUsageGauge : base.providerUsageGauge,
        onMicPress: mic === undefined ? base.onMicPress : mic?.onPress,
        isMicActive: mic === undefined ? base.isMicActive : mic?.isActive,
        // Hiding the secondary Stop must not remove the Send-position Stop's abort path.
        onAbort: overrides?.hide?.stop === true && !sendIsStop ? undefined : base.onAbort,
        sendIsStop,
        hideAbortButton: overrides?.hide?.stop === true,
        alwaysShowContextSize: hideContextUsage ? false : base.alwaysShowContextSize,
        hideContextUsage,
    };
}
