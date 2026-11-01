import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AgentInputExtraActionChip, AgentInputStatusBadge } from '@/components/sessions/agentInput/agentInputContracts';
import { renderHook, standardCleanup } from '@/dev/testkit';
import type { ConnectedServiceQuotaGaugeViewModel } from '@/sync/domains/connectedServices/connectedServiceQuotaGauge';

import {
    type ComposerBase,
    type SessionViewComposerOverrides,
    useSessionComposerOverrides,
} from './sessionComposerOverrides';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
    standardCleanup();
});

const happierChip: AgentInputExtraActionChip = { key: 'happier-chip', render: () => null };
const seamChip: AgentInputExtraActionChip = { key: 'seam-chip', render: () => null };
const happierBadge: AgentInputStatusBadge = { key: 'happier-badge', label: 'Happier' };
const seamBadge: AgentInputStatusBadge = { key: 'seam-badge', label: 'Desk' };
// Identity-only fixture: the hook passes the view model through untouched.
const happierGauge = { serviceId: 'happier' } as ConnectedServiceQuotaGaugeViewModel;
const seamGauge = { serviceId: 'desk' } as ConnectedServiceQuotaGaugeViewModel;

function buildBase(overrides: Partial<ComposerBase> = {}): ComposerBase {
    return {
        isReadOnly: false,
        placeholder: 'Type a message',
        extraActionChips: [happierChip],
        statusBadges: [happierBadge],
        providerUsageGauge: happierGauge,
        onMicPress: vi.fn(),
        isMicActive: false,
        onAbort: vi.fn(),
        alwaysShowContextSize: true,
        ...overrides,
    };
}

type HookProps = Readonly<{ base: ComposerBase; overrides: SessionViewComposerOverrides | null | undefined }>;

async function renderComposer(initialProps: HookProps) {
    return renderHook(
        (props: HookProps) => useSessionComposerOverrides(props.base, props.overrides),
        { initialProps },
    );
}

describe('useSessionComposerOverrides', () => {
    it('appends seam chips and badges after Happier ones', async () => {
        const base = buildBase();
        const hook = await renderComposer({ base, overrides: { extraActionChips: [seamChip], statusBadges: [seamBadge] } });

        expect(hook.getCurrent().extraActionChips).toEqual([happierChip, seamChip]);
        expect(hook.getCurrent().statusBadges).toEqual([happierBadge, seamBadge]);
    });

    it('seam placeholder replaces the default', async () => {
        const hook = await renderComposer({ base: buildBase(), overrides: { placeholder: 'Brief the desk' } });

        expect(hook.getCurrent().placeholder).toBe('Brief the desk');
    });

    it('view-only placeholder wins over the seam placeholder', async () => {
        const base = buildBase({ isReadOnly: true, placeholder: 'View only' });
        const hook = await renderComposer({ base, overrides: { placeholder: 'Brief the desk' } });

        expect(hook.getCurrent().placeholder).toBe('View only');
    });

    it('providerUsageGauge: null removes, a view model replaces, omitted keeps', async () => {
        const base = buildBase();

        expect((await renderComposer({ base, overrides: { providerUsageGauge: null } })).getCurrent().providerUsageGauge).toBeNull();
        expect((await renderComposer({ base, overrides: { providerUsageGauge: seamGauge } })).getCurrent().providerUsageGauge).toBe(seamGauge);
        expect((await renderComposer({ base, overrides: {} })).getCurrent().providerUsageGauge).toBe(happierGauge);
    });

    it('mic: null removes, an object replaces, omitted keeps', async () => {
        const base = buildBase();
        const onPress = vi.fn();

        const removed = (await renderComposer({ base, overrides: { mic: null } })).getCurrent();
        expect(removed.onMicPress).toBeUndefined();

        const replaced = (await renderComposer({ base, overrides: { mic: { onPress, isActive: true } } })).getCurrent();
        expect(replaced.onMicPress).toBe(onPress);
        expect(replaced.isMicActive).toBe(true);

        const kept = (await renderComposer({ base, overrides: {} })).getCurrent();
        expect(kept.onMicPress).toBe(base.onMicPress);
        expect(kept.isMicActive).toBe(false);
    });

    it('hide.stop drops onAbort', async () => {
        const base = buildBase();

        expect((await renderComposer({ base, overrides: { hide: { stop: true } } })).getCurrent().onAbort).toBeUndefined();
        expect((await renderComposer({ base, overrides: {} })).getCurrent().onAbort).toBe(base.onAbort);
    });

    it('hide.contextUsage turns off the context size badge', async () => {
        const hidden = (await renderComposer({ base: buildBase(), overrides: { hide: { contextUsage: true } } })).getCurrent();
        expect(hidden.alwaysShowContextSize).toBe(false);
        expect(hidden.hideContextUsage).toBe(true);

        const shown = (await renderComposer({ base: buildBase(), overrides: null })).getCurrent();
        expect(shown.alwaysShowContextSize).toBe(true);
        expect(shown.hideContextUsage).toBe(false);
    });

    it('keeps array references stable across rerenders and returns base arrays without overrides', async () => {
        const base = buildBase();
        const overrides: SessionViewComposerOverrides = { extraActionChips: [seamChip], statusBadges: [seamBadge] };
        const hook = await renderComposer({ base, overrides });
        const previous = hook.getCurrent();

        const next = await hook.rerender({ base, overrides });
        expect(Object.is(previous.extraActionChips, next.extraActionChips)).toBe(true);
        expect(Object.is(previous.statusBadges, next.statusBadges)).toBe(true);

        const withoutOverrides = await hook.rerender({ base, overrides: null });
        expect(withoutOverrides.extraActionChips).toBe(base.extraActionChips);
        expect(withoutOverrides.statusBadges).toBe(base.statusBadges);
    });
});
