/** @vitest-environment jsdom */
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { View } from 'react-native';
import { createSessionFixture } from '@/dev/testkit/fixtures/sessionFixtures';
import { storage } from '@/sync/domains/state/storage';
import { ApprovalsButton, ApprovalsDrawer } from './Approvals';
import { deskPrefs } from '../deskPrefs';
import { sessionAllowResult, sessionDenyResult, sessionAllowWithAnswers } from '@/sync/ops';

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    const web = await import('react-native-web');
    return createReactNativeWebMock({ View: web.View, Pressable: web.Pressable, Text: web.Text, ScrollView: web.ScrollView, TextInput: web.TextInput, Animated: web.Animated, Easing: web.Easing });
});
vi.mock('@/sync/ops', () => ({ sessionAllowWithAnswers: vi.fn(), sessionAllowResult: vi.fn(), sessionDenyResult: vi.fn() }));
vi.mock('@react-navigation/native', async () => {
    const { createReactNavigationNativeMock } = await import('@/dev/testkit/mocks/reactNavigation');
    return createReactNavigationNativeMock();
});
vi.mock('expo-router', async () => {
    const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
    return createExpoRouterMock({ pathname: '/desk' }).module;
});
vi.mock('@/hooks/ui/useReducedMotionPreference', async () => {
    const { createReducedMotionModuleMock } = await import('@/dev/testkit/mocks/reducedMotion');
    return createReducedMotionModuleMock(true);
});
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// 3.3 owns question cards. This stateful child exercises the drawer's draft contract
// without mocking WaitingPanel or introducing question controls into production.
function DraftCard({ onDirty }: { onDirty: (dirty: boolean) => void }) {
    const [text, setText] = React.useState('');
    const [picked, setPicked] = React.useState(false);
    return <>
        <input data-testid="answer" value={text} onChange={(event) => {
            setText(event.target.value); onDirty(Boolean(event.target.value) || picked);
        }} />
        <button data-testid="option" aria-pressed={picked} onClick={() => {
            setPicked(!picked); onDirty(!picked || Boolean(text));
        }}>Option</button>
    </>;
}
function Drawer({ width, draft = false }: { width: number; draft?: boolean }) {
    const [open, setOpen] = React.useState(false);
    const [dirty, setDirty] = React.useState(false);
    const openerRef = React.useRef<View>(null);
    return <>
        <ApprovalsButton open={open} onPress={() => setOpen(value => !value)} openerRef={openerRef} />
        <input data-testid="chat" />
        <ApprovalsDrawer open={open} width={width} openerRef={openerRef} onClose={() => setOpen(false)} hasHalfAnsweredCard={dirty} onDirtyChange={setDirty}>
            {draft ? <DraftCard onDirty={setDirty} /> : null}
        </ApprovalsDrawer>
    </>;
}
let root: Root;
let container: HTMLDivElement;
let previous: ReturnType<typeof storage.getState>;
let previousStyle: ReturnType<typeof deskPrefs.get<'chatStyle'>>;
beforeEach(() => {
    vi.mocked(sessionAllowResult).mockClear(); vi.mocked(sessionDenyResult).mockClear(); vi.mocked(sessionAllowWithAnswers).mockClear();
    previousStyle = deskPrefs.get('chatStyle');
    previous = storage.getState();
    storage.getState().applySessions([]);
    storage.getState().applyReady();
    container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
    await act(async () => root.unmount()); container.remove(); storage.setState(previous, true); deskPrefs.set('chatStyle', previousStyle);
});
function element(id: string) {
    const found = container.querySelector<HTMLElement>(`[data-testid="${id}"]`);
    if (!found) throw new Error(`Missing ${id}`);
    return found;
}
const visible = () => container.querySelector('[data-testid="ip-approvals-drawer"]');
async function render(width: number, draft = false) { await act(async () => root.render(<Drawer width={width} draft={draft} />)); }
async function click(id: string) { await act(async () => { element(id).focus(); element(id).click(); }); }
async function escape() { await act(async () => { document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); }); }
async function typeAnswer(value: string) {
    await act(async () => {
        const input = element('answer'); input.focus();
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });
}

it('Q13: docked stays open while the chat receives outside clicks and focus', async () => {
    await render(1440); await click('ip-approvals-open'); await click('chat');
    expect(visible()).not.toBeNull(); expect(document.activeElement).toBe(element('chat'));
});
it('Q13: overlay closes on an outside click without stealing chat focus', async () => {
    await render(1100); await click('ip-approvals-open'); await click('chat');
    expect(visible()).toBeNull(); expect(document.activeElement).toBe(element('chat'));
});
it.each(['typed', 'picked'] as const)('Q13: overlay protects a %s half-answer from outside click but allows explicit toggle', async (kind) => {
    await render(1180, true); await click('ip-approvals-open');
    if (kind === 'typed') await typeAnswer('Keep this draft'); else await click('option');
    await click('chat'); expect(visible()).not.toBeNull();
    await click('ip-approvals-open'); expect(visible()).toBeNull();
});
it.each([1100, 390])('D-series / Q13: Escape at %s closes and returns focus to Waiting, even from a draft', async (width) => {
    await render(width, true); await click('ip-approvals-open'); await typeAnswer('Unsent');
    await escape(); expect(visible()).toBeNull(); expect(document.activeElement).toBe(element('ip-approvals-open'));
});
it('D-series: phone close button returns focus to Waiting', async () => {
    await render(390); await click('ip-approvals-open'); await click('ip-approvals-close');
    expect(visible()).toBeNull(); expect(document.activeElement).toBe(element('ip-approvals-open'));
});
it('Q13: Escape returns focus to Waiting after a half-answer kept the overlay open while using chat', async () => {
    await render(1100, true); await click('ip-approvals-open'); await typeAnswer('Unsent');
    await click('chat'); expect(visible()).not.toBeNull();
    await escape(); expect(visible()).toBeNull(); expect(document.activeElement).toBe(element('ip-approvals-open'));
});
it('D-series / Q13: a clean open drawer adopts dismissal rules when resizing in both directions', async () => {
    await render(1180); await click('ip-approvals-open');
    await render(1181); await click('chat'); expect(visible()).not.toBeNull();
    await render(1180); await click('chat'); expect(visible()).toBeNull();
});
it('D-series: resizing across both thresholds preserves the mounted draft and current outside-click policy', async () => {
    await render(1180, true); await click('ip-approvals-open'); await typeAnswer('Keep this draft');
    const input = element('answer');
    for (const width of [1181, 1440, 1180, 820, 821]) {
        await render(width, true);
        expect(visible()).not.toBeNull(); expect(element('answer')).toBe(input);
        expect((input as HTMLInputElement).value).toBe('Keep this draft');
    }
    await click('chat'); expect(visible()).not.toBeNull();
    await typeAnswer(''); await click('chat'); expect(visible()).toBeNull();
});
it.each([390, 1100, 1440])('D-series: placement at %s never declares a modal', async (width) => {
    await render(width); await click('ip-approvals-open');
    expect(visible()).not.toBeNull(); expect(container.querySelector('[aria-modal="true"]')).toBeNull();
});

it('W5 / Q13: an actual picked question protects the drawer until the request disappears', async () => {
    const session = createSessionFixture({ id: 'worker', active: true, agentState: { requests: {
        request: { tool: 'AskUserQuestion', kind: 'user_action', arguments: { questions: [{
            header: 'Version', question: 'Which release?', options: [{ label: 'Stable' }], multiSelect: false,
        }] }, createdAt: 1 },
    } } });
    storage.getState().setSocketStatus('connected'); storage.getState().applySessions([session]);
    await render(1100); await click('ip-approvals-open');
    await click('ip-waiting-toggle-request');
    await click('ip-waiting-option-request-0-0'); await click('chat');
    expect(visible()).not.toBeNull();
    await act(async () => storage.getState().applySessions([{ ...session, agentStateVersion: 2, agentState: { requests: {} } }]));
    await click('chat'); expect(visible()).toBeNull();
});

it.each([390, 1440])('R47: inbox heading counts actionable and unloaded waits at %s; view-only requests remain listed', async (width) => {
    const pending = (id: string) => createSessionFixture({ id, active: true, agentState: { requests: {
        [id]: { tool: 'Bash', arguments: { command: 'echo check' }, createdAt: 1 },
    } } });
    await act(async () => {
        storage.getState().setSocketStatus('connected');
        storage.getState().applySessions([pending('owner'), { ...pending('viewer'), accessLevel: 'view' },
            createSessionFixture({ id: 'unloaded', active: true, pendingPermissionRequestCount: 1, pendingRequestObservedAt: Date.now() })]);
    });
    await render(width); await click('ip-approvals-open');
    expect(element('ip-waiting-count').textContent).toBe('2');
    expect(element('ip-waiting-heading').textContent).toContain('Waiting on you');
    expect(element('ip-approvals-drawer').getAttribute('aria-label')).toBe(element('ip-waiting-heading').textContent);
    // The canonical SVG boundary stub retains its native testID prop as a host attribute.
    expect(container.querySelectorAll('[testid="ip-waiting-mask"]')).toHaveLength(1);
    expect(element('ip-waiting-card-viewer')).toBeTruthy();
    expect(element('ip-waiting-unloaded-unloaded').textContent).toContain('Open session');
    expect(container.querySelector('[data-testid="ip-waiting-allow-owner"]')).toBeNull();
    await click('ip-waiting-toggle-viewer');
    expect(container.querySelector('[data-testid="ip-waiting-allow-viewer"]')).toBeNull();
});

it.each(['Enter', ' '])('R47: Terminal row %s toggles without submitting or denying and keeps focus on its cursor', async key => {
    deskPrefs.set('chatStyle', 'terminal');
    storage.getState().setSocketStatus('connected');
    storage.getState().applySessions([createSessionFixture({ id: 'keyboard', active: true, agentState: { requests: {
        keyboard: { tool: 'Bash', arguments: { command: 'echo keyboard' }, createdAt: 1 },
    } } })]);
    await render(390); await click('ip-approvals-open');
    const toggle = element('ip-waiting-toggle-keyboard');
    await act(async () => toggle.focus());
    expect(document.activeElement).toBe(toggle);
    expect(element('ip-waiting-cursor-keyboard').textContent).toBe('›');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    // RN Web renders a native button. jsdom does not synthesize its browser keyboard click.
    expect(toggle.tagName).toBe('BUTTON');
    for (const expanded of ['true', 'false']) {
        await act(async () => {
            toggle.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
            toggle.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true, cancelable: true }));
            // jsdom has no native button activation. Replay its click after the real key handlers.
            toggle.click();
        });
        expect(toggle.getAttribute('aria-expanded')).toBe(expanded);
        if (expanded === 'true') expect(element('ip-waiting-detail-keyboard').textContent).toContain('echo keyboard');
        expect(document.activeElement).toBe(toggle);
        expect(sessionAllowResult).not.toHaveBeenCalled(); expect(sessionDenyResult).not.toHaveBeenCalled();
        expect(sessionAllowWithAnswers).not.toHaveBeenCalled();
    }
});

it.each(['toggle', 'allow', 'question'] as const)('retains drawer focus after a focused %s request disappears, then falls back when empty', async focused => {
    const request = focused === 'question'
        ? { tool: 'AskUserQuestion', kind: 'user_action' as const, arguments: { questions: [{ question: 'Your answer?', freeform: {} }] }, createdAt: 1 }
        : { tool: 'Bash', arguments: { command: 'echo first' }, createdAt: 1 };
    const first = createSessionFixture({ id: 'first', active: true, agentState: { requests: { first: request } } });
    const second = createSessionFixture({ id: 'second', active: true, agentState: { requests: {
        second: { tool: 'Bash', arguments: { command: 'echo second' }, createdAt: 2 },
    } } });
    storage.getState().setSocketStatus('connected'); storage.getState().applySessions([first, second]);
    await render(390); await click('ip-approvals-open');
    await click('ip-waiting-toggle-first');
    await act(async () => element(focused === 'question' ? 'ip-waiting-other-first-0' : `ip-waiting-${focused}-first`).focus());
    await act(async () => storage.getState().applySessions([{ ...first, agentStateVersion: 2, agentState: { requests: {} } }]));
    expect(document.activeElement).toBe(element('ip-waiting-toggle-second'));
    await act(async () => storage.getState().applySessions([{ ...second, agentStateVersion: 2, agentState: { requests: {} } }]));
    expect(document.activeElement).toBe(element('ip-approvals-close'));
    expect(visible()).not.toBeNull();
});

it('does not steal focus from chat when an unfocused request disappears', async () => {
    const session = createSessionFixture({ id: 'worker', active: true, agentState: { requests: {
        request: { tool: 'Bash', arguments: { command: 'echo work' }, createdAt: 1 },
    } } });
    storage.getState().applySessions([session]);
    await render(1440); await click('ip-approvals-open'); await click('chat');
    await act(async () => storage.getState().applySessions([{ ...session, agentStateVersion: 2, agentState: { requests: {} } }]));
    expect(document.activeElement).toBe(element('chat'));
});
