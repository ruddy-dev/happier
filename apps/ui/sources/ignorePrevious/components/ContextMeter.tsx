import * as React from 'react';
import { View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';

import type { AgentId } from '@/agents/catalog/catalog';
import { resolveAgentIdFromFlavor } from '@/agents/registry/registryCore';
import { resolveContextWindowTokens } from '@/components/sessions/agentInput/resolveContextWarningWindowTokens';
import { formatTokenUsageCount } from '@/components/sessions/usage/tokenUsageFormatting';
import { Text } from '@/components/ui/text/Text';
import type { Session } from '@/sync/domains/state/storageTypes';
import { t } from '@/text';

import { contextMeter, type ContextMeter as Meter } from '../model/contextMeter';
import { useIpColours } from '../palette';

/**
 * Where each agent CLI auto-compacts. The browser can't read ~/.claude/settings.json, so the
 * limit is set at build time in apps/ui/.env.local; unset means "measure against the window".
 */
function autoCompactTokens(agentId: AgentId | null): number | null {
    const raw =
        agentId === 'claude'
            ? process.env.EXPO_PUBLIC_IP_AUTOCOMPACT_CLAUDE
            : agentId === 'codex'
              ? process.env.EXPO_PUBLIC_IP_AUTOCOMPACT_CODEX
              : undefined;
    const value = Number(raw);
    return raw && Number.isFinite(value) && value > 0 ? Math.trunc(value) : null;
}

/** The session's context meter, or null until the session has reported its context size. */
export function sessionContextMeter(session: Session): Meter | null {
    const usage = session.latestUsage;
    if (!usage) return null;
    const agentId = resolveAgentIdFromFlavor(session.metadata?.flavor ?? null);
    const windowTokens = agentId
        ? resolveContextWindowTokens({ agentId, metadata: session.metadata, usageData: usage })
        : (usage.contextWindowTokens ?? null);
    return contextMeter({ used: usage.contextSize, windowTokens, compactAt: autoCompactTokens(agentId) });
}

/** A bar and a percentage for how close the session is to auto-compact, with the model window beside it. */
export const ContextMeter = React.memo(function ContextMeter({ session }: { session: Session }) {
    const { theme } = useUnistyles();
    const colours = useIpColours();
    const meter = sessionContextMeter(session);
    if (!meter) return null;

    const percent = Math.round(meter.ratio * 100);
    const counts = { used: formatTokenUsageCount(meter.used), limit: formatTokenUsageCount(meter.limit) };
    const secondary = { color: theme.colors.text.secondary, fontSize: 12 };

    return (
        <View style={{ gap: 4, minWidth: 180 }}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
                <Text testID="ip-context-percent" style={{ color: theme.colors.text.primary, fontSize: 15 }}>
                    {percent}
                </Text>
                <Text style={secondary}>
                    {meter.towardsCompact ? t('ignorePrevious.contextToCompact', counts) : t('ignorePrevious.contextOfWindow', counts)}
                </Text>
            </View>
            <View style={{ height: 6, borderRadius: 3, backgroundColor: theme.colors.surface.inset, overflow: 'hidden' }}>
                <View
                    style={{
                        width: `${percent}%`,
                        height: '100%',
                        backgroundColor: meter.ratio >= 0.9 ? colours.red : colours.yellow,
                    }}
                />
            </View>
            {meter.towardsCompact && meter.windowTokens ? (
                <Text style={secondary}>{t('ignorePrevious.contextWindow', { size: formatTokenUsageCount(meter.windowTokens) })}</Text>
            ) : null}
        </View>
    );
});
