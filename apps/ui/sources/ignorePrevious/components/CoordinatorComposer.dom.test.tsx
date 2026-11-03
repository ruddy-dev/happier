/** @vitest-environment jsdom */
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { AgentInput } from '@/components/sessions/agentInput/AgentInput';
import { WebDropTargetView } from '@/components/sessions/files/repositoryTree/WebDropTargetView';
import { RunSettingsMenu } from './RunSettingsMenu';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MultiTextInput, type MultiTextInputHandle } from '@/components/ui/forms/MultiTextInput.web';
import { createSessionFixture } from '@/dev/testkit/fixtures/sessionFixtures';
import { storage } from '@/sync/domains/state/storage';
import { t } from '@/text';
import { apiSocket } from '@/sync/api/session/apiSocket';
import { applyDeskFixture } from '../fixtures/applyDeskFixture';
import { DeskDemoContext } from '../deskFixtureGate';
import demo from '../fixtures/demo/desk-demo.json';
import { getDemoConversation } from '../fixtures/demoConversation';
import { installAgentAssetLoader } from '@/dev/testkit/mocks/agentAssets';
import { deskPrefs } from '../deskPrefs';
import { CoordinatorComposer } from './CoordinatorComposer';

// Keep the real web hosts and Animated.Value; RN Web lacks RN's hook.
vi.mock('react-native', async () => {
    const web = await vi.importActual<typeof import('react-native')>('react-native-web');
    return { ...web, useAnimatedValue: (value: number) => React.useRef(new web.Animated.Value(value)).current };
});
vi.mock('@react-navigation/native', () => ({ useIsFocused: () => true }));
vi.mock('@/modal', async () => {
    const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
    return createModalModuleMock().module;
});
// Vitest does not perform Metro's web extension resolution for the fixture's platform input.
vi.mock('@/components/ui/forms/MultiTextInput', async () => vi.importActual('@/components/ui/forms/MultiTextInput.web'));
vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock();
});
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let releaseFixture: (() => void) | undefined;
let before: ReturnType<typeof storage.getState>;
const handle = React.createRef<MultiTextInputHandle>();
const secondHandle = React.createRef<MultiTextInputHandle>();
const searchHandle = React.createRef<MultiTextInputHandle>();

function Input({ value = '', inputRef = handle, testID = 'session-composer-input' }: {
    value?: string; inputRef?: React.RefObject<MultiTextInputHandle | null>; testID?: string;
}) {
    const [draft, setDraft] = React.useState(value);
    React.useEffect(() => setDraft(value), [value]);
    return <WebDropTargetView testID={testID === 'session-composer-input' ? 'agent-input-drop-zone' : 'other-drop-zone'}>
        <MultiTextInput ref={inputRef} value={draft} onChangeText={setDraft} testID={testID} />
    </WebDropTargetView>;
}
const render = (value = '', session = 'coordinator') => act(async () => root.render(
    <CoordinatorComposer key={session}><Input value={value} /></CoordinatorComposer>,
));
const find = (id: string) => container.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const status = () => find('ip-composer-draft-status')?.textContent;
const position = () => find('ip-composer-position')?.textContent;

beforeEach(() => {
    before = storage.getState();
    deskPrefs.set('chatStyle', 'terminal');
    storage.getState().applySettingsLocal({ agentInputActionBarLayout: 'wrap' });
    container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
    await act(async () => { await root.unmount(); releaseFixture?.(); });
    container.remove(); releaseFixture = undefined; storage.setState(before, true);
    deskPrefs.set('chatStyle', 'mask');
    vi.restoreAllMocks(); vi.unstubAllGlobals();
});

it('R45 keeps the real global waits summary visible on empty drafts, including cold-load unknown and unloaded requests', async () => {
    storage.setState({ sessions: {}, sessionListRenderables: {}, isDataReady: false });
    await render();
    expect(status()).toBe(t('ignorePrevious.composer.ready'));
    expect(find('ip-composer-waiting')?.textContent).toBe(t('ignorePrevious.composer.waitingUnknown'));
    expect(find('ip-composer-position')).toBeNull();
    await act(async () => {
        storage.getState().applySessions([
            createSessionFixture({ id: 'coordinator', active: true, pendingPermissionRequestCount: 1 }),
            createSessionFixture({ id: 'worker', active: true, pendingUserActionRequestCount: 1 }),
        ]);
        storage.getState().applyReady();
    });
    expect(find('ip-composer-waiting')?.textContent).toBe(t('ignorePrevious.composer.waiting', { count: 2 }));
    await act(async () => storage.getState().deleteSessions(['coordinator', 'worker']));
    expect(find('ip-composer-waiting')?.textContent).toBe(t('ignorePrevious.composer.waiting', { count: 0 }));
});

it('R45 reads pasted text, keyboard and backward mouse selection, imperative edits and external clear/replacement', async () => {
    await render();
    const input = handle.current!.getInputElement()!;
    await act(async () => {
        input.focus();
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, 'first\nsecond');
        input.setSelectionRange(9, 9);
        input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste' }));
    });
    expect(status()).toBe(t('ignorePrevious.composer.writing'));
    expect(position()).toBe(t('ignorePrevious.composer.position', { line: 2, column: 4 }));
    await act(async () => {
        input.setSelectionRange(0, 8, 'backward');
        document.dispatchEvent(new Event('selectionchange', { bubbles: true }));
    });
    expect(position()).toBe(t('ignorePrevious.composer.position', { line: 1, column: 1 }));
    await act(async () => handle.current!.setSelection({ start: 7, end: 7 }));
    expect(position()).toBe(t('ignorePrevious.composer.position', { line: 2, column: 2 }));
    await act(async () => handle.current!.setTextAndSelection('single line', { start: 2, end: 2 }));
    expect(status()).toBe(t('ignorePrevious.composer.writing')); expect(find('ip-composer-position')).toBeNull();
    await render('replacement\nnext');
    expect(position()).toBe(t('ignorePrevious.composer.position', { line: 2, column: 5 }));
    await render('');
    expect(status()).toBe(t('ignorePrevious.composer.ready')); expect(find('ip-composer-position')).toBeNull();
    await render('restored\ndraft', 'another-session');
    expect(status()).toBe(t('ignorePrevious.composer.writing'));
    expect(position()).toBe(t('ignorePrevious.composer.position', { line: 1, column: 1 }));
});

it('R45 isolates two panes and ignores non-composer inputs and ordinary Happier inputs', async () => {
    await act(async () => root.render(<>
        <section data-pane="one"><CoordinatorComposer><Input /><Input inputRef={searchHandle} testID="search" /></CoordinatorComposer></section>
        <section data-pane="two"><CoordinatorComposer><Input inputRef={secondHandle} /></CoordinatorComposer></section>
        <Input testID="plain" inputRef={React.createRef()} />
    </>));
    await act(async () => handle.current!.setTextAndSelection('one\ntwo', { start: 1, end: 1 }));
    const states = container.querySelectorAll('[data-testid="ip-composer-draft-status"]');
    expect([...states].map(node => node.textContent)).toEqual([t('ignorePrevious.composer.writing'), t('ignorePrevious.composer.ready')]);
    expect(container.querySelector('[data-pane="one"] [data-testid="ip-composer-position"]')?.textContent)
        .toBe(t('ignorePrevious.composer.position', { line: 1, column: 2 }));
    expect(container.querySelectorAll('[data-testid="ip-composer-prompt"]')).toHaveLength(2);
    await act(async () => {
        handle.current!.setTextAndSelection('', { start: 0, end: 0 });
        searchHandle.current!.setTextAndSelection('not a draft', { start: 1, end: 1 });
        secondHandle.current!.setTextAndSelection('second', { start: 2, end: 2 });
    });
    expect([...states].map(node => node.textContent)).toEqual([t('ignorePrevious.composer.ready'), t('ignorePrevious.composer.writing')]);
    await act(async () => deskPrefs.set('chatStyle', 'mask'));
    expect(find('ip-composer-status-strip')).toBeNull(); expect(find('ip-composer-prompt')).toBeNull();
});

it('R45 keeps draft, cursor and global waits subscriptions out of the transcript', async () => {
    const Transcript = vi.fn(() => <div>Transcript</div>);
    await act(async () => root.render(<CoordinatorComposer><Transcript /><Input /></CoordinatorComposer>));
    await act(async () => handle.current!.setTextAndSelection('first\nsecond', { start: 8, end: 8 }));
    await act(async () => handle.current!.setSelection({ start: 9, end: 9 }));
    await act(async () => {
        storage.getState().applySessions([createSessionFixture({ id: 'worker', active: true, pendingPermissionRequestCount: 1 })]);
        storage.getState().applyReady();
    });
    expect(position()).toBe(t('ignorePrevious.composer.position', { line: 2, column: 4 }));
    expect(find('ip-composer-waiting')?.textContent).toBe(t('ignorePrevious.composer.waiting', { count: 1 }));
    expect(Transcript).toHaveBeenCalledTimes(1);
});

const safeArea = { top: 0, right: 0, bottom: 0, left: 0 };
const noSend = () => {};
const noSuggestions = async () => [];
function RealComposer({ visible = true, draft = '', desk = true }: { visible?: boolean; draft?: string; desk?: boolean }) {
    const input = visible ? <AgentInput sessionId="coordinator" value={draft} onChangeText={() => {}} onSend={noSend}
        placeholder={t('ignorePrevious.composer.placeholder')} autocompleteKinds={[]} autocompleteSuggestions={noSuggestions}
        footerLeadingActions={<RunSettingsMenu />} statusTrailingActions={<span data-testid="fixture-context">Context</span>} />
        : <div data-testid="session-unavailable" />;
    return <SafeAreaInsetsContext.Provider value={safeArea}>
        {desk ? <CoordinatorComposer>{input}</CoordinatorComposer> : input}
    </SafeAreaInsetsContext.Provider>;
}

it('R45 removes status with the real composer, then re-observes empty and restored drafts in the same pane', async () => {
    const show = (visible: boolean, draft = '') => act(async () => root.render(<RealComposer visible={visible} draft={draft} />));
    await show(true, 'first\nsecond');
    expect(status()).toBe(t('ignorePrevious.composer.writing'));
    expect(position()).toBeDefined();
    await show(false);
    expect(find('session-unavailable')).not.toBeNull();
    expect(find('ip-composer-status-strip')).toBeNull();
    expect(find('ip-composer-position')).toBeNull();
    await show(true);
    expect(status()).toBe(t('ignorePrevious.composer.ready'));
    expect(find('ip-composer-position')).toBeNull();
    await show(false);
    await show(true, 'restored\ndraft');
    expect(status()).toBe(t('ignorePrevious.composer.writing'));
    expect(position()).toBe(t('ignorePrevious.composer.position', { line: 1, column: 1 }));
});

it('R45 appends status after real controls inside the actual composer box, leaving host slots and ordinary inputs intact', async () => {
    await act(async () => root.render(<RealComposer />));
    const box = find('agent-input-drop-zone')!;
    const strip = find('ip-composer-status-strip')!;
    expect(box.contains(strip)).toBe(true);
    expect(box.lastElementChild).toBe(strip);
    expect(box.contains(find('ip-run-settings'))).toBe(true);
    expect(find('agent-input-status-trailing')!.contains(find('fixture-context'))).toBe(true);
    await act(async () => root.render(<RealComposer desk={false} />));
    expect(find('ip-composer-status-strip')).toBeNull();
    expect(find('ip-composer-prompt')).toBeNull();
    expect(find('agent-input-action-footer')).not.toBeNull();
});

async function renderFixture(demoRoute = false) {
    storage.getState().applySettingsLocal({ agentInputEnterToSend: true });
    await installAgentAssetLoader();
    const { CoordinatorBodyStub } = await import('../fixtures/CoordinatorBodyStub');
    await act(async () => root.render(<DeskDemoContext.Provider value={demoRoute}><SafeAreaInsetsContext.Provider value={safeArea}><CoordinatorComposer><CoordinatorBodyStub
        footerLeadingActions={<RunSettingsMenu />}
        statusTrailingActions={<span data-testid="fixture-context">Context</span>} />
    </CoordinatorComposer></SafeAreaInsetsContext.Provider></DeskDemoContext.Provider>));
}

it.each([false, true])('R45 fixture state controls exclude demo identity with demo context %s and preserve playback permissions', async (demoRoute) => {
    releaseFixture = applyDeskFixture();
    await renderFixture();
    for (const state of ['idle', 'busy', 'readonly']) expect(find(`ip-fixture-composer-${state}`)).not.toBeNull();
    expect(find('agent-input-root')).not.toBeNull();
    await act(async () => {
        releaseFixture?.();
        releaseFixture = applyDeskFixture(Date.now(), 'demo');
    });
    await renderFixture(demoRoute);
    const session = storage.getState().sessions[demo.coordinatorId];
    const player = getDemoConversation()!;
    const playback = player.getSnapshot();
    expect(session.accessLevel).toBe('view');
    await act(async () => {
        for (const state of ['busy', 'readonly', 'idle']) find(`ip-fixture-composer-${state}`)?.click();
    });
    expect(storage.getState().sessions[demo.coordinatorId]).toBe(session);
    expect(player.getSnapshot()).toBe(playback);
    expect(find('ip-fixture-composer-states')).toBeNull();
    for (const state of ['idle', 'busy', 'readonly']) expect(find(`ip-fixture-composer-${state}`)).toBeNull();
    expect(find('agent-input-root')).not.toBeNull();
    const input = container.querySelector<HTMLTextAreaElement>('[data-testid="session-composer-input"]')!;
    expect(input.readOnly || input.disabled).toBe(true);
});

it('R45 fixture idle Claude Plan uses production controls while synthetic send stays disabled', async () => {
    releaseFixture = applyDeskFixture();
    await renderFixture();
    expect(find('ip-fixture-composer-idle')).not.toBeNull();
    expect(find('agent-input-session-mode-chip')?.textContent).toContain('Plan');
    expect(find('session-composer-send')?.getAttribute('aria-label')).toBe(t('common.send'));
    expect(find('agent-input-abort')).toBeNull();
    expect(container.querySelector(`[aria-label="${t('voiceAssistant.label')}"]`)).toBeNull();
    const input = container.querySelector<HTMLTextAreaElement>('[data-testid="session-composer-input"]')!;
    expect(input.placeholder).toBe(t('ignorePrevious.composer.placeholder'));
    expect(find('agent-input-root')).not.toBeNull();
    expect(find('agent-input-permission-chip')).not.toBeNull();
    expect(find('agent-input-action-footer')!.contains(find('ip-run-settings'))).toBe(true);
    expect(find('agent-input-status-trailing')!.contains(find('fixture-context'))).toBe(true);
    expect(find('ip-composer-prompt')).not.toBeNull();
    const submit = find('session-composer-send')!;
    expect(submit.getAttribute('aria-disabled')).toBe('true');
    await act(async () => {
        input.focus();
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, 'preview\ntext');
        input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
    });
    expect(status()).toBe(t('ignorePrevious.composer.writing'));
    expect(position()).toBe(t('ignorePrevious.composer.position', { line: 2, column: 5 }));
    expect(submit.getAttribute('aria-disabled')).toBe('true');
    await act(async () => {
        submit.click();
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(input.value).toBe('preview\ntext');
    expect(status()).toBe(t('ignorePrevious.composer.writing'));
    expect(find('agent-input-drop-zone')!.contains(find('ip-composer-status-strip'))).toBe(true);
});

it('R45 fixture busy Codex permission state keeps Stop local for click and shortcut, with send disabled', async () => {
    const release = applyDeskFixture();
    try {
        await renderFixture();
        expect(find('ip-fixture-composer-busy')).not.toBeNull();
        await act(async () => find('ip-fixture-composer-busy')!.click());
        const submit = find('session-composer-send')!;
        expect(submit.getAttribute('aria-label')).toBe(t('runs.stop.stopRunA11y'));
        expect(submit.getAttribute('aria-disabled')).not.toBe('true');
        expect(find('agent-input-permission-chip')?.textContent).toContain(t('agentInput.codexPermissionMode.safeYolo'));
        expect(storage.getState().sessions['fx-coord'].metadata?.flavor).toBe('codex');
        expect(find('agent-input-abort')).toBeNull();
        expect(container.querySelector(`[aria-label="${t('voiceAssistant.label')}"]`)).toBeNull();
        const input = container.querySelector<HTMLTextAreaElement>('[data-testid="session-composer-input"]')!;
        await act(async () => {
            input.focus();
            Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, 'offline draft');
            input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
        });
        const rpc = vi.spyOn(apiSocket, 'sessionRPC');
        const send = vi.spyOn(apiSocket, 'send');
        const request = vi.spyOn(apiSocket, 'request');
        try {
            await act(async () => submit.click());
            await act(async () => { await new Promise(resolve => setTimeout(resolve, 350)); });
            await act(async () => {
                input.focus();
                input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', shiftKey: true, bubbles: true }));
                input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', shiftKey: true, bubbles: true }));
                input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
            });
            await act(async () => { await new Promise(resolve => setTimeout(resolve, 350)); });
            expect(rpc).not.toHaveBeenCalled();
            expect(send).not.toHaveBeenCalled();
            expect(request).not.toHaveBeenCalled();
            expect(input.value).toBe('offline draft');
            expect(storage.getState().sessions['fx-coord'].thinking).toBe(true);
        } finally { rpc.mockRestore(); send.mockRestore(); request.mockRestore(); }
        await act(async () => find('ip-fixture-composer-idle')!.click());
        expect(submit.getAttribute('aria-label')).toBe(t('common.send'));
        expect(submit.getAttribute('aria-disabled')).toBe('true');
        expect(find('agent-input-session-mode-chip')?.textContent).toContain('Plan');
        expect(input.value).toBe('offline draft');
    } finally { await act(async () => release()); }
});

it('R45 fixture read-only signal suppresses busy Stop and typing', async () => {
    const release = applyDeskFixture();
    try {
        await renderFixture();
        expect(find('ip-fixture-composer-readonly')).not.toBeNull();
        await act(async () => find('ip-fixture-composer-readonly')!.click());
        const input = container.querySelector<HTMLTextAreaElement>('[data-testid="session-composer-input"]')!;
        expect(input.readOnly || input.disabled).toBe(true);
        expect(input.placeholder).toBe(t('session.sharing.viewOnlyMode'));
        expect(find('session-composer-send')?.getAttribute('aria-label')).toBe(t('common.send'));
        expect(find('session-composer-send')?.getAttribute('aria-disabled')).toBe('true');
        expect(storage.getState().sessions['fx-coord'].thinking).toBe(true);
    } finally { await act(async () => release()); }
});

it('R45 reports column one before a leading newline', async () => {
    await render();
    await act(async () => handle.current!.setTextAndSelection('\nnext', { start: 0, end: 0 }));
    expect(position()).toBe(t('ignorePrevious.composer.position', { line: 1, column: 1 }));
});

it('R45 follows cancelled IME text', async () => {
    await render('first\nsecond');
    const input = handle.current!.getInputElement()!;
    await act(async () => {
        input.focus();
        input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, 'first\nsecond interim');
        input.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }));
    });
    expect(status()).toBe(t('ignorePrevious.composer.writing'));
    expect(position()).toBe(t('ignorePrevious.composer.position', { line: 2, column: 15 }));
    await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, 'first\nsecond');
        input.setSelectionRange(0, 0);
        input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
    });
    expect(position()).toBe(t('ignorePrevious.composer.position', { line: 1, column: 1 }));
});
