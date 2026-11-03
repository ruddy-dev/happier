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
import { ipPalette } from '../palette';
import { sessionAllowResult, sessionDenyResult, sessionAllowWithAnswers } from '@/sync/ops';
import { createDeferred } from '@/dev/testkit';
import { createWaitingHistory } from './WaitingPanel';
import type { SessionPermissionResult } from '@/sync/ops/sessions';
import { Modal } from '@/modal';
import * as waitingItems from '../model/waitingItems';
import * as transcriptReader from '@/sync/domains/messages/readStoredSessionMessages';
import { readDeskWaits } from '../model/useDeskWaits';
import type { NormalizedMessage } from '@/sync/typesRaw';

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    const web = await import('react-native-web');
    return createReactNativeWebMock({ View: web.View, Pressable: web.Pressable, Text: web.Text, ScrollView: web.ScrollView, TextInput: web.TextInput, Animated: web.Animated, Easing: web.Easing });
});
vi.mock('@/sync/ops', () => ({ sessionAllowWithAnswers: vi.fn(), sessionAllowResult: vi.fn(), sessionDenyResult: vi.fn() }));
vi.mock('@/modal', async () => {
    const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
    return createModalModuleMock().module;
});
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
    const [history] = React.useState(createWaitingHistory);
    return <>
        <ApprovalsButton open={open} onPress={() => setOpen(value => !value)} openerRef={openerRef} />
        <input data-testid="chat" />
        <ApprovalsDrawer open={open} width={width} openerRef={openerRef} onClose={() => setOpen(false)} history={history} hasHalfAnsweredCard={dirty} onDirtyChange={setDirty}>
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
    vi.mocked(Modal.alert).mockClear();
    previousStyle = deskPrefs.get('chatStyle');
    previous = storage.getState();
    storage.getState().applySessions([]);
    storage.getState().applyReady();
    container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
    await act(async () => root.unmount()); container.remove(); storage.setState(previous, true); deskPrefs.set('chatStyle', previousStyle);
    vi.restoreAllMocks();
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
    expect(element('ip-waiting-count').textContent).toBe('2 requests');
    expect(element('ip-waiting-heading').textContent).toContain('Waiting on you');
    expect(element('ip-approvals-drawer').getAttribute('aria-label')).toContain('Waiting on you');
    expect(element('ip-approvals-drawer').getAttribute('aria-label')).toMatch(/\d+ requests/);
    // The canonical SVG boundary stub retains its native testID prop as a host attribute.
    expect(container.querySelectorAll('[testid="ip-waiting-mask"]')).toHaveLength(1);
    expect(element('ip-waiting-card-viewer')).toBeTruthy();
    expect(element('ip-waiting-unloaded-unloaded').textContent).toContain('Open session');
    expect(container.querySelector('[data-testid="ip-waiting-allow-owner"]')).toBeNull();
    await click('ip-waiting-toggle-viewer');
    expect(container.querySelector('[data-testid="ip-waiting-allow-viewer"]')).toBeNull();
});

it.each([390, 1440])('P2: request units and restricted meanings are available before disclosure at %s', async width => {
    const now = Date.now();
    const pending = (id: string, accessLevel?: 'view' | 'edit' | 'admin') => createSessionFixture({
        id, active: true, activeAt: now, updatedAt: now, accessLevel,
        canApprovePermissions: accessLevel ? false : undefined,
        agentState: { requests: {
            [id]: { tool: 'Bash', arguments: { command: `echo ${id}` }, createdAt: now },
            ...(id === 'owner' ? { second: { tool: 'Bash', arguments: { command: 'echo second' }, createdAt: now } } : {}),
        } },
    });
    await act(async () => {
        storage.getState().setSocketStatus('connected');
        storage.getState().applySessions([pending('owner'), pending('viewer', 'view'), pending('editor', 'edit'), pending('admin', 'admin')]);
    });
    await render(width);
    expect(element('ip-approvals-count').textContent).toBe('4 requests');
    expect(element('ip-approvals-open').getAttribute('aria-label')).toContain('4 requests');
    await click('ip-approvals-open');
    expect(element('ip-waiting-count').textContent).toBe('4 requests');
    expect(element('ip-approvals-drawer').getAttribute('aria-label')).toContain('4 requests');
    for (const [id, note] of [
        ['viewer', 'View only · outside request count'],
        ['editor', 'Can edit, cannot approve · in request count'],
        ['admin', 'Can edit, cannot approve · in request count'],
    ]) {
        const toggle = element(`ip-waiting-toggle-${id}`);
        expect(toggle.getAttribute('aria-expanded')).toBe('false');
        expect(toggle.textContent).toContain(note);
        expect(toggle.getAttribute('aria-label')).toContain(note);
        expect(container.querySelector(`[data-testid="ip-waiting-detail-${id}"]`)).toBeNull();
    }
    expect(element('ip-waiting-toggle-owner').textContent).not.toMatch(/cannot approve|View only/);
    expect(element('ip-waiting-toggle-second')).toBeTruthy();
    expect(element('ip-waiting-toggle-owner').getAttribute('aria-label')).not.toMatch(/cannot approve|View only/);
    expect(sessionAllowResult).not.toHaveBeenCalled();
    expect(sessionDenyResult).not.toHaveBeenCalled();
});

it('P2: unloaded restricted requests explain their count membership before opening a session', async () => {
    await act(async () => {
        storage.getState().setSocketStatus('connected');
        storage.getState().applySessions((['view', 'edit'] as const).map(accessLevel => createSessionFixture({
            id: accessLevel, active: true, accessLevel, canApprovePermissions: false,
            pendingPermissionRequestCount: 1, pendingRequestObservedAt: Date.now(),
        })));
    });
    await render(390); await click('ip-approvals-open');
    expect(element('ip-waiting-unloaded-view').textContent).toContain('View only · outside request count');
    expect(element('ip-waiting-unloaded-edit').textContent).toContain('Can edit, cannot approve · in request count');
    expect(element('ip-waiting-count').textContent).toBe('1 request');
});

it('P2: unknown request counts remain unknown in visible and accessible summaries', async () => {
    storage.setState({ isDataReady: false });
    await render(390);
    expect(element('ip-approvals-count').textContent).toBe('– requests');
    expect(element('ip-approvals-open').getAttribute('aria-label')).toMatch(/request count unknown.*connecting/i);
    await click('ip-approvals-open');
    expect(element('ip-waiting-count').textContent).toBe('– requests');
    expect(element('ip-approvals-drawer').getAttribute('aria-label')).toMatch(/request count unknown.*connecting/i);
    expect(element('ip-waiting-connecting')).toBeTruthy();
});

it.each(['mask', 'terminal'] as const)('R61: %s Waiting renders the verified side-eye mask at 22px with its red rest bulb', async style => {
    deskPrefs.set('chatStyle', style);
    await render(1440); await click('ip-approvals-open');
    const masks = container.querySelectorAll('[testid="ip-waiting-mask"]');
    expect(masks).toHaveLength(1);
    const mask = masks[0];
    expect(mask.getAttribute('width')).toBe('22');
    expect(Number(mask.getAttribute('height'))).toBeCloseTo(22 * 1.08);
    expect.soft(mask.getAttribute('viewBox')).toBe('40 -40 920 1040');
    // R61 pins the logo artwork, including the visor-coloured side-eye highlights.
    expect.soft([...mask.querySelectorAll('path')].map(path => path.getAttribute('d'))).toEqual([
        'M232 616H470v47c0 77-48 132-119 132s-119-55-119-132z',
        'M530 616h238v47c0 77-48 132-119 132s-119-55-119-132z',
        'M290 665c13 41 38 67 72 67 37 0 65-29 70-74h-48c-4 20-16 31-35 31-22 0-39-8-59-24z',
        'M588 665c13 41 38 67 72 67 37 0 65-29 70-74h-48c-4 20-16 31-35 31-22 0-39-8-59-24z',
    ]);
    for (const highlight of [...mask.querySelectorAll('path')].slice(2)) {
        expect(highlight.parentElement?.getAttribute('fill')).toBe(ipPalette.light.visor);
    }
    const bulb = mask.querySelector('[testid="ip-bulb-rest"]');
    expect(bulb).not.toBeNull();
    expect(bulb?.getAttribute('cx')).toBe('500');
    expect(bulb?.getAttribute('cy')).toBe('164');
    expect(bulb?.getAttribute('r')).toBe('59');
    expect(bulb?.getAttribute('fill')).toBe(ipPalette.light.red);
    // The drawer and heading retain the label; the decorative SVG adds no second label.
    expect(mask.getAttribute('accessibilityLabel')).toBeNull();
    expect(mask.getAttribute('aria-label')).toBeNull();
    expect(element('ip-approvals-drawer').getAttribute('aria-label')).toContain('Waiting on you');
    expect(element('ip-approvals-drawer').getAttribute('aria-label')).toMatch(/\d+ requests/);
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

it.each(['allow', 'deny', 'answer'] as const)('drawer reopen during %s keeps the pending and settled state reactive', async action => {
    const gate = createDeferred<SessionPermissionResult>();
    if (action === 'answer') vi.mocked(sessionAllowWithAnswers).mockImplementationOnce(async () => { await gate.promise; });
    else vi.mocked(action === 'allow' ? sessionAllowResult : sessionDenyResult).mockReturnValueOnce(gate.promise);
    storage.getState().setSocketStatus('connected');
    storage.getState().applySessions([createSessionFixture({ id: 'worker', active: true, agentState: { requests: {
        request: action === 'answer'
            ? { tool: 'AskUserQuestion', kind: 'user_action', arguments: { questions: [{ question: 'Choose?', options: [{ label: 'Unit' }] }] }, createdAt: 1 }
            : { tool: 'Bash', arguments: { command: 'echo pending' }, createdAt: 1 },
    } } })]);
    await render(390); await click('ip-approvals-open'); await click('ip-waiting-toggle-request');
    if (action === 'answer') await click('ip-waiting-option-request-0-0');
    const actionId = `ip-waiting-${action === 'answer' ? 'send' : action}-request`;
    await click(actionId);
    await click('ip-approvals-close');
    expect(visible()).toBeNull();
    await click('ip-approvals-open'); await click('ip-waiting-toggle-request');
    const busy = element(actionId).getAttribute('aria-busy');
    try {
        await click(actionId);
    } finally { await act(async () => gate.resolve({ ok: true })); }
    // No request-store update accompanies completion. The open drawer must react anyway.
    expect(element(actionId).getAttribute('aria-disabled')).toBe('true');
    await click(actionId);
    expect(vi.mocked(sessionAllowResult).mock.calls.length + vi.mocked(sessionDenyResult).mock.calls.length + vi.mocked(sessionAllowWithAnswers).mock.calls.length).toBe(1);
    expect(busy).toBe('true');
});

it('view-only question text stays escaped and has no hidden Enter action through permission changes', async () => {
    const session = createSessionFixture({ id: 'viewer', active: true, accessLevel: 'view', agentState: { requests: {
        request: { tool: 'AskUserQuestion', kind: 'user_action', arguments: { questions: [{
            question: 'Choose <img src=x onerror=alert(1)>\u202E', options: [{ label: 'Unit\u2066', description: 'Safe <script>\u200B' }], freeform: {},
        }] }, createdAt: 1 },
    } } });
    storage.getState().setSocketStatus('connected'); storage.getState().applySessions([session]);
    await render(390); await click('ip-approvals-open');
    const toggle = element('ip-waiting-toggle-request');
    await click('ip-waiting-toggle-request');
    expect(element('ip-waiting-detail-request').textContent).toContain('Choose <img src=x onerror=alert(1)>⟨U+202E⟩');
    expect(element('ip-waiting-detail-request').textContent).toContain('Unit⟨U+2066⟩');
    expect(element('ip-waiting-detail-request').textContent).toContain('Safe <script>⟨U+200B⟩');
    expect(element('ip-waiting-detail-request').querySelectorAll('img,script,input,textarea')).toHaveLength(0);
    expect(element('ip-waiting-detail-request').querySelectorAll('[role="button"],button')).toHaveLength(1); // Open session only.
    await act(async () => {
        toggle.focus();
        toggle.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
        toggle.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true, cancelable: true }));
        toggle.click(); // jsdom does not synthesize native button activation.
    });
    await act(async () => storage.getState().applySessions([{ ...session, accessLevel: 'edit', canApprovePermissions: true, updatedAt: 2 }]));
    // The collapsed row's retained controls also cannot submit via Enter.
    await act(async () => element('ip-waiting-detail-request').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    expect(sessionAllowResult).not.toHaveBeenCalled(); expect(sessionDenyResult).not.toHaveBeenCalled(); expect(sessionAllowWithAnswers).not.toHaveBeenCalled();
});

function occurrence(version = 1, present = true) {
    return createSessionFixture({ id: 'worker', active: true, agentStateVersion: version, agentState: { requests: present ? {
        request: { tool: 'Bash', arguments: { command: 'echo same raw content' }, createdAt: 1 },
    } : {} } });
}
async function openOccurrence() {
    await click('ip-approvals-open');
    await click('ip-waiting-toggle-request');
}

it('a mounted card can answer an identical occurrence after a batched departure and return', async () => {
    storage.getState().setSocketStatus('connected'); storage.getState().applySessions([occurrence()]);
    await render(390); await openOccurrence(); await click('ip-waiting-allow-request');
    const toggle = element('ip-waiting-toggle-request');
    await act(async () => {
        storage.getState().applySessions([occurrence(2, false)]);
        storage.getState().applySessions([occurrence(3)]);
    });
    expect(element('ip-waiting-toggle-request')).toBe(toggle);
    expect(element('ip-waiting-allow-request').getAttribute('aria-disabled')).not.toBe('true');
    await click('ip-waiting-allow-request');
    expect(sessionAllowResult).toHaveBeenCalledTimes(2);
});

it.each(['success', 'legacy', 'expired', 'failure'] as const)('late %s while still absent cannot disable its later identical return', async result => {
    const pending = createDeferred<SessionPermissionResult | void>();
    // Older adapters can resolve void, which the action contract intentionally accepts.
    vi.mocked(sessionAllowResult).mockReturnValueOnce(pending.promise as Promise<SessionPermissionResult>);
    storage.getState().setSocketStatus('connected'); storage.getState().applySessions([occurrence()]);
    await render(390); await openOccurrence(); await click('ip-waiting-allow-request');
    await click('ip-approvals-close');
    await act(async () => storage.getState().applySessions([occurrence(2, false)]));
    await act(async () => {
        if (result === 'failure') pending.reject(new Error('old failure'));
        else if (result === 'expired') pending.resolve({ ok: false, errorMessage: 'gone', requestId: 'request', errorCode: 'permission_request_expired' });
        else pending.resolve(result === 'legacy' ? undefined : { ok: true });
    });
    expect(Modal.alert).not.toHaveBeenCalled();
    await act(async () => storage.getState().applySessions([occurrence(3)]));
    await openOccurrence();
    expect(element('ip-waiting-allow-request').getAttribute('aria-disabled')).not.toBe('true');
    await click('ip-waiting-allow-request');
    expect(sessionAllowResult).toHaveBeenCalledTimes(2);
});

it.each(['sent', 'unavailable'] as const)('closed %s state is retired after disappearance and identical return', async outcome => {
    vi.mocked(sessionAllowResult).mockResolvedValueOnce(outcome === 'sent' ? { ok: true }
        : { ok: false, errorMessage: 'gone', requestId: 'request', errorCode: 'permission_request_expired' });
    storage.getState().setSocketStatus('connected'); storage.getState().applySessions([occurrence()]);
    await render(390); await openOccurrence(); await click('ip-waiting-allow-request');
    expect(element('ip-waiting-allow-request').getAttribute('aria-disabled')).toBe('true');
    await click('ip-approvals-close');
    await act(async () => storage.getState().applySessions([occurrence(2, false)]));
    await act(async () => storage.getState().applySessions([occurrence(3)]));
    await openOccurrence();
    expect(element('ip-waiting-allow-request').getAttribute('aria-disabled')).not.toBe('true');
    await click('ip-waiting-allow-request');
    expect(sessionAllowResult).toHaveBeenCalledTimes(2);
});

it.each([false, true])('closed disappearance and return are observed with transcript loaded=%s and changed completions', async loaded => {
    storage.getState().setSocketStatus('connected'); storage.getState().applySessions([occurrence()]);
    storage.getState().applyMessages('worker', [{ id: 'text', localId: null, createdAt: 1,
        role: 'agent', isSidechain: false, content: [{ type: 'text', text: 'Working', uuid: 'text', parentUUID: null }] }]);
    if (loaded) storage.getState().applyMessagesLoaded('worker');
    await render(390); await openOccurrence(); await click('ip-waiting-allow-request');
    await click('ip-approvals-close');
    await act(async () => storage.getState().applySessions([{ ...occurrence(2, false), agentState: {
        requests: {}, completedRequests: { request: { tool: 'Bash', arguments: { command: 'echo same raw content' },
            createdAt: 1, completedAt: 2, status: 'approved' } },
    } }]));
    const returned = occurrence(3);
    returned.agentState!.requests!.request.createdAt = 3;
    await act(async () => storage.getState().applySessions([returned]));
    await openOccurrence();
    expect(element('ip-waiting-allow-request').getAttribute('aria-disabled')).not.toBe('true');
    await click('ip-waiting-allow-request');
    expect(sessionAllowResult).toHaveBeenCalledTimes(2);
});

it.each(['success', 'legacy', 'expired', 'failure'] as const)('closed disappearance/return rejects late %s but keeps the actual call locked', async result => {
    const pending = createDeferred<SessionPermissionResult>();
    vi.mocked(sessionAllowResult).mockReturnValueOnce(pending.promise);
    storage.getState().setSocketStatus('connected'); storage.getState().applySessions([occurrence()]);
    await render(390); await openOccurrence(); await click('ip-waiting-allow-request');
    await click('ip-approvals-close');
    await act(async () => storage.getState().applySessions([occurrence(2, false)]));
    await act(async () => storage.getState().applySessions([occurrence(3)]));
    await openOccurrence();
    try {
        await click('ip-waiting-allow-request');
        expect(sessionAllowResult).toHaveBeenCalledTimes(1);
    } finally {
        await act(async () => {
            if (result === 'failure') pending.reject(new Error('old failure'));
            else if (result === 'expired') pending.resolve({ ok: false, errorMessage: 'gone', requestId: 'request', errorCode: 'permission_request_expired' });
            else if (result === 'legacy') pending.resolve(undefined as unknown as SessionPermissionResult);
            else pending.resolve({ ok: true });
        });
    }
    expect(Modal.alert).not.toHaveBeenCalled();
    expect(element('ip-waiting-allow-request').getAttribute('aria-disabled')).toBe('true');
    await click('ip-waiting-allow-request');
    expect(sessionAllowResult).toHaveBeenCalledTimes(1);
});

it('settlement while closed builds no details, and tracks only the acted-on request during token writes', async () => {
    const pending = createDeferred<SessionPermissionResult>();
    vi.mocked(sessionAllowResult).mockReturnValueOnce(pending.promise);
    storage.getState().setSocketStatus('connected'); storage.getState().applySessions([occurrence()]);
    await render(390); await openOccurrence(); await click('ip-waiting-allow-request');
    await click('ip-approvals-close');
    await act(async () => storage.getState().applySessions([createSessionFixture({ id: 'streaming', active: true,
        pendingPermissionRequestCount: 0, pendingUserActionRequestCount: 0 })]));
    const details = vi.spyOn(waitingItems, 'toWaitingItems');
    const reads = vi.spyOn(transcriptReader, 'readStoredSessionMessagesFromStateLike');
    const directReads = vi.spyOn(transcriptReader, 'readStoredSessionMessages');
    for (let i = 0; i < 5; i++) await act(async () => storage.getState().applyMessages('streaming', [{
        id: `token-${i}`, localId: null, createdAt: 10 + i, role: 'agent', isSidechain: false,
        content: [{ type: 'text', text: `token ${i}`, uuid: `token-${i}`, parentUUID: null }],
    }]));
    expect(reads).not.toHaveBeenCalled();
    expect(directReads).not.toHaveBeenCalled();
    await act(async () => storage.getState().applySessions([{ ...occurrence(), metadataVersion: 2,
        metadata: { ...occurrence().metadata!, name: 'New title while closed' } }]));
    // applySessions derives its list row from the transcript. Isolate the late RPC below from
    // that producer work; it must not rebuild the now-invalidated drawer projection.
    directReads.mockClear();
    await act(async () => pending.reject(new Error('retry me')));
    expect(details).not.toHaveBeenCalled();
    expect(reads).not.toHaveBeenCalled();
    expect(directReads).not.toHaveBeenCalled();
    await openOccurrence();
    expect(element('ip-waiting-allow-request').getAttribute('aria-disabled')).not.toBe('true');
    await click('ip-waiting-allow-request');
    expect(sessionAllowResult).toHaveBeenCalledTimes(2);
});

it('closed permission revoke/re-grant and stale observations preserve the same live sent request', async () => {
    storage.getState().setSocketStatus('connected'); storage.getState().applySessions([occurrence(3)]);
    await render(390); await openOccurrence(); await click('ip-waiting-allow-request');
    await click('ip-approvals-close');
    await act(async () => storage.getState().applySessions([{ ...occurrence(3), accessLevel: 'view', updatedAt: 20 }]));
    await act(async () => storage.getState().applySessions([occurrence(2, false)])); // Older agentState must lose.
    await act(async () => storage.getState().applySessions([{ ...occurrence(3), accessLevel: 'edit', canApprovePermissions: true, updatedAt: 30 }]));
    expect(readDeskWaits().count).toBe(1);
    await openOccurrence();
    expect(element('ip-waiting-allow-request').getAttribute('aria-disabled')).toBe('true');
    await click('ip-waiting-allow-request');
    expect(sessionAllowResult).toHaveBeenCalledTimes(1);
});

function transcriptOccurrence(createdAt = 1): NormalizedMessage {
    return { id: `transcript-${createdAt}`, localId: null, createdAt, role: 'agent', isSidechain: false,
        content: [{ type: 'tool-call', id: 'request', name: 'bash',
            input: { permissionId: 'request', status: 'pending', command: 'echo same raw content' },
            description: null, uuid: `transcript-${createdAt}`, parentUUID: null }] };
}
function loadTranscriptOccurrence() {
    storage.getState().setSocketStatus('connected');
    storage.getState().applySessions([createSessionFixture({ id: 'worker', active: true,
        agentState: null, pendingPermissionRequestCount: 1 })]);
    storage.getState().applyMessages('worker', [transcriptOccurrence()]);
    storage.getState().applyMessagesLoaded('worker');
}
async function terminalAndReturnTranscript() {
    await act(async () => storage.getState().applyMessages('worker', [{
        id: 'transcript-result', localId: null, createdAt: 2, role: 'agent', isSidechain: false,
        content: [{ type: 'tool-result', tool_use_id: 'request', content: 'done', is_error: false,
            permissions: { result: 'approved', date: 2 }, uuid: 'transcript-result', parentUUID: null }],
    }]));
    expect(storage.getState().sessionMessages.worker.isLoaded).toBe(true);
    expect(storage.getState().sessionMessages.worker.renderableAggregate?.requestStates.get('request')?.status).toBe('terminal');
    expect(storage.getState().sessions.worker.pendingPermissionRequestCount).toBe(1);
    await act(async () => {
        // Model a refreshed transcript returning the identical ID, raw payload and timestamp.
        storage.getState().resetSessionMessages('worker');
        storage.getState().applyMessages('worker', [transcriptOccurrence()]);
        storage.getState().applyMessagesLoaded('worker');
    });
}

it.each(['sent', 'unavailable'] as const)('loaded transcript-only %s feedback cannot settle its identical successor while count stays positive', async phase => {
    vi.mocked(sessionAllowResult).mockResolvedValueOnce(phase === 'sent' ? { ok: true }
        : { ok: false, errorMessage: 'gone', requestId: 'request', errorCode: 'permission_request_expired' });
    loadTranscriptOccurrence();
    await render(390); await openOccurrence(); await click('ip-waiting-allow-request');
    await click('ip-approvals-close');
    await terminalAndReturnTranscript();
    await openOccurrence();
    expect(element('ip-waiting-allow-request').getAttribute('aria-disabled')).not.toBe('true');
    await click('ip-waiting-allow-request');
    expect(sessionAllowResult).toHaveBeenCalledTimes(2);
});

it.each(['success', 'legacy', 'expired', 'failure'] as const)('loaded transcript-only successor rejects late %s and retains the shared transport lock', async result => {
    const pending = createDeferred<SessionPermissionResult>();
    vi.mocked(sessionAllowResult).mockReturnValueOnce(pending.promise);
    loadTranscriptOccurrence();
    await render(390); await openOccurrence(); await click('ip-waiting-allow-request');
    await click('ip-approvals-close');
    await terminalAndReturnTranscript();
    await openOccurrence();
    try {
        expect(element('ip-waiting-allow-request').getAttribute('aria-disabled')).toBe('true');
        await click('ip-waiting-allow-request');
        expect(sessionAllowResult).toHaveBeenCalledTimes(1);
    } finally {
        await act(async () => {
            if (result === 'failure') pending.reject(new Error('old failure'));
            else if (result === 'expired') pending.resolve({ ok: false, errorMessage: 'gone', requestId: 'request', errorCode: 'permission_request_expired' });
            else if (result === 'legacy') pending.resolve(undefined as unknown as SessionPermissionResult);
            else pending.resolve({ ok: true });
        });
    }
    expect(Modal.alert).not.toHaveBeenCalled();
    expect(element('ip-waiting-allow-request').getAttribute('aria-disabled')).toBe('true');
    await click('ip-waiting-allow-request');
    expect(sessionAllowResult).toHaveBeenCalledTimes(1);
});
