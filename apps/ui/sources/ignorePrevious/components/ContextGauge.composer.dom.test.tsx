/** @vitest-environment jsdom */
import * as React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { expect, it, vi } from 'vitest';
import { AgentInput } from '@/components/sessions/agentInput/AgentInput';
import { useSessionComposerOverrides, type ComposerBase } from '@/components/sessions/model/sessionComposerOverrides';
import { storage } from '@/sync/domains/state/storage';

vi.mock('react-native', async () => vi.importActual('react-native-web'));
vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock();
});
vi.mock('@/modal', async () => {
    const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
    return createModalModuleMock().module;
});
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const base: ComposerBase = {
    isReadOnly: false, placeholder: '', extraActionChips: undefined, statusBadges: [],
    onMicPress: undefined, isMicActive: undefined, onAbort: undefined, alwaysShowContextSize: true,
    providerUsageGauge: {
        serviceId: 'claude-subscription', providerDisplayName: 'Claude', activeAccountDisplayLabel: null,
        remainingPct: 18, usedPct: 82, valueLabel: '18% left', ringValueLabel: '18', badgeLabel: '18% left',
        scopePrefix: null, primaryValueSemantics: 'remaining', detailRightLabel: '18% left',
        usedLimitLabel: '82/100 used', resetLabel: null, tone: 'warning', isStale: false,
        recoveryCreditSummary: null, effectiveMeter: {
            meterId: 'weekly', label: 'Weekly', used: 82, limit: 100, unit: 'count',
            utilizationPct: null, resetsAt: null, status: 'ok', details: {},
        }, usageRings: [], allMeterRows: [],
    },
};
function Composer({ desk }: { desk: boolean }) {
    const resolved = useSessionComposerOverrides(base, desk ? { providerUsageGauge: null, hide: { contextUsage: true } } : undefined);
    // SessionView's usage adapter omits usageData when hideContextUsage is true.
    return <AgentInput value="" onChangeText={() => {}} onSend={() => {}} autocompleteKinds={[]}
        autocompleteSuggestions={async () => []} agentType="claude" {...resolved}
        usageData={resolved.hideContextUsage ? undefined : {
            inputTokens: 0, outputTokens: 0, cacheCreation: 0, cacheRead: 0,
            contextSize: 95_500, contextSizeIsReported: true, contextWindowTokens: 1_000_000,
        }} />;
}
it('C9 the real AgentInput hides both Happier gauges with desk overrides and retains both with plain SessionView defaults', async () => {
    const before = storage.getState();
    // jsdom reports a zero-width viewport unless the platform measurement is supplied.
    const width = vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(1200);
    window.dispatchEvent(new Event('resize'));
    storage.getState().applySettingsLocal({ agentInputActionBarLayout: 'wrap' });
    const container = document.createElement('div'); document.body.append(container);
    const root = createRoot(container);
    const render = async (desk: boolean) => act(async () => root.render(
        <SafeAreaInsetsContext.Provider value={{ top: 0, right: 0, bottom: 0, left: 0 }}><Composer desk={desk} /></SafeAreaInsetsContext.Provider>,
    ));
    try {
        await render(false);
        expect(container.querySelector('[data-testid="agent-input-context-usage-badge"]')).not.toBeNull();
        expect(container.querySelector('[data-testid="agent-input-provider-usage-badge"]')).not.toBeNull();
        await render(true);
        expect(container.querySelector('[data-testid="agent-input-context-usage-badge"]')).toBeNull();
        expect(container.querySelector('[data-testid="agent-input-provider-usage-badge"]')).toBeNull();
        await render(false);
        expect(container.querySelector('[data-testid="agent-input-context-usage-badge"]')).not.toBeNull();
        expect(container.querySelector('[data-testid="agent-input-provider-usage-badge"]')).not.toBeNull();
    } finally {
        await act(async () => root.unmount()); container.remove(); storage.setState(before, true); width.mockRestore();
    }
});
