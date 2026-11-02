import * as React from 'react';
import { View } from 'react-native';
import { expect, it, vi } from 'vitest';
import { renderScreen } from '@/dev/testkit';
import { AgentInput } from '@/components/sessions/agentInput/AgentInput';
import { useSessionComposerOverrides, type SessionViewComposerOverrides } from '@/components/sessions/model/sessionComposerOverrides';
import { storage } from '@/sync/domains/state/storage';
import { RunSettingsMenu } from './RunSettingsMenu';

vi.mock('react-native-unistyles', async () => { const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles'); return createUnistylesMock(); });
vi.mock('@/modal', async () => { const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal'); return createModalModuleMock().module; });
function Composer({ desk }: { desk: boolean }) {
    const overrides: SessionViewComposerOverrides | undefined = desk ? { footerLeadingActions: <RunSettingsMenu /> } : undefined;
    const resolved = useSessionComposerOverrides({ isReadOnly: false, placeholder: '', extraActionChips: undefined, statusBadges: [], providerUsageGauge: undefined, onMicPress: undefined, isMicActive: undefined, onAbort: undefined, alwaysShowContextSize: false }, overrides);
    return <View><AgentInput value="" onChangeText={() => {}} onSend={() => {}} autocompleteKinds={[]} autocompleteSuggestions={async () => []} {...resolved} /></View>;
}
it('M9 places the desk run button inside the action footer even when collapsed; ordinary composers have no extra node', async () => {
    storage.getState().applySettingsLocal({ agentInputActionBarLayout: 'collapsed' });
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
