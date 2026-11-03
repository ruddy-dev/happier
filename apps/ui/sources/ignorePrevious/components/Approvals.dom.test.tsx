/** @vitest-environment jsdom */
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { View } from 'react-native';
import { createSessionFixture } from '@/dev/testkit/fixtures/sessionFixtures';
import { buildSessionListRenderableFromSession } from '@/sync/domains/session/listing/sessionListRenderable';
import { storage } from '@/sync/domains/state/storage';
import { t } from '@/text';
import { ApprovalsButton, ApprovalsDrawer } from './Approvals';

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
beforeEach(() => {
    previous = storage.getState();
    storage.getState().applySessions([]);
    storage.getState().applyReady();
    container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
    await act(async () => root.unmount()); container.remove(); storage.setState(previous, true);
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

it('R10/R24: mixed desktop and phone badges count editable waits without granting approval or hiding view-only rows', async () => {
    const loaded = (id: string, accessLevel?: 'edit' | 'view') => createSessionFixture({
        id, active: true, accessLevel, canApprovePermissions: false,
        agentState: { requests: { [id]: { tool: 'Bash', arguments: { command: `${id}-command` }, createdAt: 1 } } },
    });
    await act(async () => {
        storage.getState().applySessions([loaded('owner'), loaded('editor', 'edit'), loaded('viewer', 'view')]);
        storage.getState().mergeSessionListRenderables((['edit', 'view'] as const).map(accessLevel => buildSessionListRenderableFromSession(createSessionFixture({
            id: `${accessLevel}-unloaded`, active: true, accessLevel,
            canApprovePermissions: false, pendingPermissionRequestCount: 1,
        }))));
    });
    await act(async () => root.render(<><ApprovalsButton open={false} onPress={() => {}} /><ApprovalsButton phone open={false} onPress={() => {}} /></>));
    expect([...container.querySelectorAll('[data-testid="ip-approvals-count"]')].map(node => node.textContent)).toEqual(['3', '3']);
    await render(1440);
    await click('ip-approvals-open');
    expect(element('ip-approvals-count').textContent).toBe('3');
    const listing = element('ip-waiting');
    expect(listing.textContent).toContain('editor-command');
    expect(listing.textContent).toContain('viewer-command');
    expect([...listing.querySelectorAll('[role="button"]')].filter(button => button.textContent === t('ignorePrevious.openSession'))).toHaveLength(5);
    expect([...listing.querySelectorAll('[data-testid^="ip-waiting-allow-"]')].map(node => node.getAttribute('data-testid'))).toEqual(['ip-waiting-allow-owner']);
    expect([...listing.querySelectorAll('[data-testid^="ip-waiting-deny-"]')].map(node => node.getAttribute('data-testid'))).toEqual(['ip-waiting-deny-owner']);
});

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
    await click('ip-waiting-option-request-0-0'); await click('chat');
    expect(visible()).not.toBeNull();
    await act(async () => storage.getState().applySessions([{ ...session, agentStateVersion: 2, agentState: { requests: {} } }]));
    await click('chat'); expect(visible()).toBeNull();
});
