/** @vitest-environment jsdom */
import * as React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AgentInput } from '@/components/sessions/agentInput/AgentInput';
import { useSessionComposerOverrides, type ComposerBase } from '@/components/sessions/model/sessionComposerOverrides';
import { createSessionFixture } from '@/dev/testkit/fixtures/sessionFixtures';
import { storage } from '@/sync/domains/state/storage';
import { stubServerFeaturesFetch } from '@/hooks/server/serverFeaturesTestUtils';
import { resetServerFeaturesClientForTests } from '@/sync/api/capabilities/serverFeaturesClient';
import { t } from '@/text';
import { useDeskComposerControls } from '../model/useDeskComposerControls';
import { deskPrefs } from '../deskPrefs';
import { CoordinatorComposer } from './CoordinatorComposer';

beforeEach(() => deskPrefs.set('chatStyle', 'terminal'));
afterEach(() => deskPrefs.set('chatStyle', 'mask'));

// RN Web lacks RN's useAnimatedValue hook; keep its real Animated.Value and hosts.
vi.mock('react-native', async () => {
    const web = await vi.importActual<typeof import('react-native')>('react-native-web');
    return { ...web, useAnimatedValue: (value: number) => React.useRef(new web.Animated.Value(value)).current };
});
// Navigation focus is an app-host boundary; this composer is visible.
vi.mock('@react-navigation/native', () => ({ useIsFocused: () => true }));
// Resolve the real platform input the way Metro's web build does.
vi.mock('@/components/ui/forms/MultiTextInput', async () => vi.importActual('@/components/ui/forms/MultiTextInput.web'));
vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles'); return createUnistylesMock();
});
vi.mock('@/modal', async () => {
    const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal'); return createModalModuleMock().module;
});
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const abort = vi.fn(async () => {});
const send = vi.fn();
const mic = vi.fn();
const base: ComposerBase = {
    isReadOnly: false, placeholder: 'Type', extraActionChips: undefined, statusBadges: [],
    onMicPress: mic, isMicActive: false, onAbort: abort, alwaysShowContextSize: false, providerUsageGauge: null,
};
function Composer({ desk, draft }: { desk: boolean; draft: string }) {
    const controls = useDeskComposerControls('coordinator');
    const resolved = useSessionComposerOverrides(base, desk ? controls : undefined);
    const input = <AgentInput sessionId="coordinator" value={draft} onChangeText={() => {}} onSend={send}
        showAbortButton={true} onFileViewerPress={() => {}} autocompleteKinds={[]} autocompleteSuggestions={async () => []} agentType="claude" {...resolved} />;
    return desk ? <CoordinatorComposer>{input}</CoordinatorComposer> : input;
}
it('Finding 3: R13 desk Stop owns Send and Shift+Escape, aborts once and restores draft focus; plain composer keeps mic and secondary Stop', async () => {
    const before = storage.getState();
    const width = vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(1200);
    window.dispatchEvent(new Event('resize'));
    stubServerFeaturesFetch({ voiceEnabled: true });
    resetServerFeaturesClientForTests();
    storage.getState().applySettingsLocal({ agentInputActionBarLayout: 'wrap', experiments: true, featureToggles: { voice: true } });
    const seed = async (thinking: boolean) => act(async () => storage.getState().applySessions([
        createSessionFixture({ id: 'coordinator', active: true, activeAt: Date.now(), thinking, thinkingAt: Date.now() }),
    ]));
    const container = document.createElement('div'); document.body.append(container); const root = createRoot(container);
    const render = async (desk: boolean, draft = '') => act(async () => root.render(
        <SafeAreaInsetsContext.Provider value={{ top: 0, right: 0, bottom: 0, left: 0 }}><Composer desk={desk} draft={draft} /></SafeAreaInsetsContext.Provider>,
    ));
    const submit = () => container.querySelector<HTMLElement>('[data-testid="session-composer-send"]')!;
    try {
        await seed(true); await render(true, 'Keep this draft');
        expect(container.querySelector('[data-testid="ip-composer-draft-status"]')?.textContent).toBe(t('ignorePrevious.composer.writing'));
        expect(submit().getAttribute('aria-label')).toBe(t('runs.stop.stopRunA11y'));
        expect(container.querySelector('[data-testid="agent-input-abort"]')).toBeNull();
        expect(container.querySelector(`[aria-label="${t('voiceAssistant.label')}"]`)).toBeNull();
        await act(async () => { submit().focus(); submit().click(); submit().click(); });
        await act(async () => { await new Promise(resolve => setTimeout(resolve, 350)); });
        expect(abort).toHaveBeenCalledTimes(1); expect(send).not.toHaveBeenCalled(); expect(mic).not.toHaveBeenCalled();
        expect(document.activeElement?.tagName).toBe('TEXTAREA');
        expect((document.activeElement as HTMLTextAreaElement).value).toBe('Keep this draft');
        const input = document.activeElement!;
        await act(async () => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', shiftKey: true, bubbles: true })); });
        expect(abort).toHaveBeenCalledTimes(1);
        await act(async () => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', shiftKey: true, bubbles: true })); });
        await act(async () => { await new Promise(resolve => setTimeout(resolve, 350)); });
        expect(abort).toHaveBeenCalledTimes(2);
        await seed(false);
        expect(submit().getAttribute('aria-label')).toBe(t('common.send'));
        await render(true);
        expect(submit().getAttribute('aria-label')).toBe(t('common.send'));
        expect(container.querySelector('[data-testid="ip-composer-draft-status"]')?.textContent).toBe(t('ignorePrevious.composer.ready'));
        await render(false);
        expect(container.querySelector('[data-testid="ip-composer-status-strip"]')).toBeNull();
        expect(submit().getAttribute('aria-label')).toBe(t('voiceAssistant.label'));
        expect(container.querySelector('[data-testid="agent-input-abort"]')).not.toBeNull();
    } finally {
        await act(async () => root.unmount()); container.remove(); storage.setState(before, true); width.mockRestore(); vi.unstubAllGlobals(); resetServerFeaturesClientForTests();
    }
});

it('Finding 1: collapsed busy desk menu omits Stop while plain composer retains it', async () => {
    const before = storage.getState();
    const container = document.createElement('div'); document.body.append(container); const root = createRoot(container);
    try {
        storage.getState().applySettingsLocal({ agentInputActionBarLayout: 'collapsed' });
        await act(async () => storage.getState().applySessions([createSessionFixture({ id: 'coordinator', active: true, activeAt: Date.now(), thinking: true, thinkingAt: Date.now() })]));
        const render = async (desk: boolean) => act(async () => root.render(<SafeAreaInsetsContext.Provider value={{ top: 0, right: 0, bottom: 0, left: 0 }}><Composer desk={desk} draft="draft" /></SafeAreaInsetsContext.Provider>));
        const open = async () => {
            const button = document.querySelector<HTMLElement>('[data-testid="agent-input-action-menu-button"]');
            expect(button).not.toBeNull();
            await act(async () => button!.click());
        };
        await render(true); await open();
        expect(document.body.textContent).not.toContain(t('agentInput.actionMenu.stop'));
        await render(false);
        await open();
        expect(document.body.textContent).toContain(t('agentInput.actionMenu.stop'));
    } finally { await act(async () => root.unmount()); container.remove(); storage.setState(before, true); }
});

it('Finding 5: Enter queues a draft while the desk button shows Stop', async () => {
    const before = storage.getState();
    const container = document.createElement('div'); document.body.append(container); const root = createRoot(container);
    try {
        send.mockClear();
        storage.getState().applySettingsLocal({ agentInputEnterToSend: true });
        await act(async () => storage.getState().applySessions([createSessionFixture({ id: 'coordinator', active: true, activeAt: Date.now(), thinking: true, thinkingAt: Date.now() })]));
        await act(async () => root.render(<SafeAreaInsetsContext.Provider value={{ top: 0, right: 0, bottom: 0, left: 0 }}><Composer desk draft="queued draft" /></SafeAreaInsetsContext.Provider>));
        expect(container.querySelector('[data-testid="session-composer-send"]')?.getAttribute('aria-label')).toBe(t('runs.stop.stopRunA11y'));
        const input = container.querySelector('textarea')!;
        await act(async () => { input.focus(); input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
        expect(send).toHaveBeenCalledTimes(1);
    } finally { await act(async () => root.unmount()); container.remove(); storage.setState(before, true); }
});
