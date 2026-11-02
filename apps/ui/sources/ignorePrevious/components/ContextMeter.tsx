import type { AgentId } from '@/agents/catalog/catalog';
import { resolveAgentIdFromFlavor } from '@/agents/registry/registryCore';
import { resolveContextWindowTokens } from '@/components/sessions/agentInput/resolveContextWarningWindowTokens';
import type { Session } from '@/sync/domains/state/storageTypes';

import { contextMeter, type ContextMeter as Meter } from '../model/contextMeter';

/**
 * Where each agent CLI auto-compacts. The browser can't read ~/.claude/settings.json, so the
 * limit is set at build time in apps/ui/.env.local; unset means "measure against the window".
 */
function autoCompactSetting(agentId: AgentId | null) {
    const setting = agentId === 'claude' ? 'EXPO_PUBLIC_IP_AUTOCOMPACT_CLAUDE'
        : agentId === 'codex' ? 'EXPO_PUBLIC_IP_AUTOCOMPACT_CODEX' : null;
    const raw =
        agentId === 'claude'
            ? process.env.EXPO_PUBLIC_IP_AUTOCOMPACT_CLAUDE
            : agentId === 'codex'
              ? process.env.EXPO_PUBLIC_IP_AUTOCOMPACT_CODEX
              : undefined;
    const value = Number(raw);
    return { setting, tokens: raw && Number.isFinite(value) && value > 0 ? Math.trunc(value) : null };
}

/** The session's context meter, or null until the session has reported its context size. */
export function sessionContextMeter(session: Session): (Meter & { compactSetting: string | null }) | null {
    const usage = session.latestUsage;
    if (!usage) return null;
    const agentId = resolveAgentIdFromFlavor(session.metadata?.flavor ?? null);
    const windowTokens = agentId
        ? resolveContextWindowTokens({ agentId, metadata: session.metadata, usageData: usage })
        : (usage.contextWindowTokens ?? null);
    const compact = autoCompactSetting(agentId);
    const meter = contextMeter({ used: usage.contextSize, windowTokens, compactAt: compact.tokens });
    return meter ? { ...meter, compactSetting: compact.setting } : null;
}
