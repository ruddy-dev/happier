import * as React from 'react';
import { View } from 'react-native';
import { expect, it, vi } from 'vitest';
import { renderScreen } from '@/dev/testkit';
import { AgentInput } from '@/components/sessions/agentInput/AgentInput';
import { useSessionComposerOverrides, type SessionViewComposerOverrides } from '@/components/sessions/model/sessionComposerOverrides';
import { storage } from '@/sync/domains/state/storage';
import { RunSettingsMenu } from './RunSettingsMenu';
import { CoordinatorComposer } from './CoordinatorComposer';

vi.mock('react-native-unistyles', async () => { const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles'); return createUnistylesMock(); });
vi.mock('@/modal', async () => { const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal'); return createModalModuleMock().module; });
vi.mock('react-native', async () => { const { createReactNativeNativeMock } = await import('@/dev/testkit/mocks/reactNative'); return createReactNativeNativeMock({ platformOS: 'ios' }); });
function Composer({ desk, phone = false }: { desk: boolean; phone?: boolean }) {
    const overrides: SessionViewComposerOverrides | undefined = desk ? { footerLeadingActions: <RunSettingsMenu /> } : undefined;
    const resolved = useSessionComposerOverrides({ isReadOnly: false, placeholder: '', extraActionChips: undefined, statusBadges: [], providerUsageGauge: undefined, onMicPress: undefined, isMicActive: undefined, onAbort: undefined, alwaysShowContextSize: false }, overrides);
    const input = <AgentInput {...resolved} value="" onChangeText={() => {}} onSend={() => {}} permissionMode="default" onPermissionModeChange={() => {}}
        extraActionChips={[{ key: 'delivery', controlId: 'delivery', render: () => <View testID="fixture-extra-control" /> }]}
        autocompleteKinds={[]} autocompleteSuggestions={async () => []} />;
    return <View>{desk ? <CoordinatorComposer phone={phone}>{input}</CoordinatorComposer> : input}</View>;
}
it.each(['auto', 'wrap', 'scroll', 'collapsed'] as const)('M9 places the desk run button inside the %s action footer; ordinary composers have no extra node', async (layout) => {
    storage.getState().applySettingsLocal({ agentInputActionBarLayout: layout });
    const desk = await renderScreen(<Composer desk />);
    const button = desk.findByTestId('ip-run-settings');
    expect(button).not.toBeNull();
    let ancestor = button?.parent;
    while (ancestor && ancestor.props.testID !== 'agent-input-action-footer') ancestor = ancestor.parent;
    expect(ancestor).not.toBeNull();
    await desk.unmount();
    const ordinary = await renderScreen(<Composer desk={false} />);
    expect(ordinary.findByTestId('ip-run-settings')).toBeNull();
});

it('gives the native phone desk run control a full-width line above the scroll row', async () => {
    storage.getState().applySettingsLocal({ agentInputActionBarLayout: 'scroll' });
    const screen = await renderScreen(<Composer desk phone />);
    const run = screen.findByTestId('ip-run-settings');
    let ancestor = run?.parent;
    while (ancestor && !(Array.isArray(ancestor.props.style) ? ancestor.props.style : [ancestor.props.style]).some((style: { width?: string } | null) => style?.width === '100%')) ancestor = ancestor.parent;
    expect(ancestor).toBeTruthy();
    const row = screen.findByTestId('agent-input-desk-controls-row');
    expect(row).toBeTruthy();
    expect(screen.findByTestId('agent-input-permission-chip')).toBeTruthy();
    expect(screen.findByTestId('fixture-extra-control')).toBeTruthy();
    expect(screen.findByTestId('new-session-composer-send')).toBeTruthy();
    expect(ancestor?.findAll((node) => node.props.testID === 'new-session-composer-send')).toHaveLength(0);
    await screen.unmount();
});
