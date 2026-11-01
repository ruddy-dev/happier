import * as React from 'react';

import type {
    AgentInputExtraActionChip,
    AgentInputStatusBadge,
} from '@/components/sessions/agentInput/agentInputContracts';
import type { ConnectedServiceQuotaGaugeViewModel } from '@/sync/domains/connectedServices/connectedServiceQuotaGauge';

/**
 * Optional composer customisation a host screen can pass to SessionView.
 * Omitted fields keep Happier's behaviour. Callers should memoise the object:
 * SessionView is React.memo.
 */
export type SessionViewComposerOverrides = Readonly<{
    placeholder?: string;
    /** Appended after Happier's chips. */
    extraActionChips?: ReadonlyArray<AgentInputExtraActionChip>;
    /** Appended after Happier's badges. */
    statusBadges?: ReadonlyArray<AgentInputStatusBadge>;
    statusTrailingActions?: React.ReactNode;
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
    hideContextUsage: boolean;
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
): ResolvedComposer {
    const extraActionChips = useAppended(base.extraActionChips, overrides?.extraActionChips);
    const statusBadges = useAppended(base.statusBadges, overrides?.statusBadges);

    const mic = overrides?.mic;
    const hideContextUsage = overrides?.hide?.contextUsage === true;

    return {
        // A view-only session keeps its own placeholder so the reader knows why typing is off.
        placeholder: base.isReadOnly ? base.placeholder : (overrides?.placeholder ?? base.placeholder),
        extraActionChips,
        statusBadges,
        statusTrailingActions: overrides?.statusTrailingActions,
        providerUsageGauge: overrides?.providerUsageGauge !== undefined ? overrides.providerUsageGauge : base.providerUsageGauge,
        onMicPress: mic === undefined ? base.onMicPress : (mic?.onPress ?? undefined),
        isMicActive: mic === undefined ? base.isMicActive : (mic?.isActive ?? undefined),
        onAbort: overrides?.hide?.stop === true ? undefined : base.onAbort,
        alwaysShowContextSize: hideContextUsage ? false : base.alwaysShowContextSize,
        hideContextUsage,
    };
}
