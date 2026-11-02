/** @vitest-environment jsdom */
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createSessionFixture } from '@/dev/testkit/fixtures/sessionFixtures';
import { storage } from '@/sync/domains/state/storage';
import type { WaitingItem } from '../model/waitingItems';
import { getApprovalsOpen, setApprovalsOpen, setStoredCoordinatorId, setWorkCollapsed } from '../deskPrefs';
import { DeskScreen } from './DeskScreen';

const viewport = vi.hoisted(() => ({ width: 1000, height: 900, scale: 1, fontScale: 1 }));
vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    const web = await import('react-native-web');
    return createReactNativeWebMock({
        View: web.View, Pressable: web.Pressable, Text: web.Text, TextInput: web.TextInput, ScrollView: web.ScrollView,
        Animated: web.Animated, Easing: web.Easing, useWindowDimensions: () => viewport,
    });
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
// SessionView is the external chat host. Focus its composer before drawer mount effects run.
vi.mock('@/components/sessions/shell/SessionView', () => ({
    SessionView: () => <>
        <input data-testid="composer" autoFocus />
        <button data-testid="chat-action">Chat action</button>
    </>,
}));
vi.mock('@/hooks/session/useHydrateSessionForRoute', async () => {
    const { deskScreenMocks } = await import('../testkit/deskScreenMocks');
    return deskScreenMocks.hydrateSessionForRoute();
});
// Explicitly requested stub for 3.3's future editable card. WaitingPanel, its
// per-card aggregation, DeskScreen and the drawer dismissal policy stay real.
vi.mock('../components/WaitingCard', async (importOriginal) => {
    const original = await importOriginal<typeof import('../components/WaitingCard')>();
    return { ...original, WaitingCard: ({ item, onDirtyChange }: {
        item: WaitingItem; onDirtyChange?: (dirty: boolean) => void;
    }) => <>
        <button data-testid={`pick-${item.requestId}`} onClick={() => onDirtyChange?.(true)}>Pick</button>
        <input data-testid={`text-${item.requestId}`} onChange={event => onDirtyChange?.(Boolean(event.target.value))} />
        <button data-testid={`send-${item.requestId}`} onClick={() => onDirtyChange?.(false)}>Send</button>
        <button data-testid={`discard-${item.requestId}`} onClick={() => onDirtyChange?.(false)}>Discard</button>
    </> };
});

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
let previous: ReturnType<typeof storage.getState>;
beforeEach(() => {
    previous = storage.getState();
    viewport.width = 1000;
    setApprovalsOpen(false); setWorkCollapsed(false); setStoredCoordinatorId('coordinator');
    storage.getState().applySessions([createSessionFixture({ id: 'coordinator', active: true })]);
    storage.getState().applyReady();
    container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
    await act(async () => root.unmount()); container.remove(); storage.setState(previous, true);
    setApprovalsOpen(false); setStoredCoordinatorId(null); setWorkCollapsed(false);
});
function element(id: string) {
    const found = container.querySelector<HTMLElement>(`[data-testid="${id}"]`);
    if (!found) throw new Error(`Missing ${id}`);
    return found;
}
const drawer = () => container.querySelector<HTMLElement>('[data-testid="ip-approvals-drawer"]');
async function render(width = viewport.width) {
    viewport.width = width;
    await act(async () => root.render(<DeskScreen />));
}
async function click(id: string) { await act(async () => { element(id).focus(); element(id).click(); }); }
async function escape() {
    await act(async () => { document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
}
function seedCards(requestIds = ['first', 'second']) {
    storage.getState().applySessions([createSessionFixture({
        id: 'worker', active: true, agentState: {
            requests: Object.fromEntries(requestIds.map(id => [id, { tool: 'AskUserQuestion', arguments: {}, createdAt: 1 }])),
        },
    })]);
}
async function type(id: string, text: string) {
    await act(async () => {
        const input = element(id);
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, text);
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });
}

it('Medium 1: stored open at 390 starts closed without rewriting the stored choice', async () => {
    setApprovalsOpen(true); await render(390);
    expect(drawer()).toBeNull(); expect(getApprovalsOpen()).toBe(true);
    expect(document.activeElement).toBe(element('composer'));
    await render(1440); expect(drawer()).toBeNull();
    await click('ip-approvals-open'); expect(drawer()).not.toBeNull();
});
it('Medium 1: stored open at 1440 stays docked without stealing composer focus on load or resize', async () => {
    setApprovalsOpen(true); await render(1440);
    expect(drawer()).not.toBeNull(); expect(document.activeElement).toBe(element('composer'));
    await render(1000); expect(document.activeElement).toBe(element('composer'));
    await render(390); expect(document.activeElement).toBe(element('composer'));
    expect(drawer()).not.toBeNull();
});
it('Medium 1 / Low 6: user open at 1000 focuses Close only on opening', async () => {
    await render(1000); await click('ip-approvals-open');
    expect(document.activeElement).toBe(element('ip-approvals-close'));
    await act(async () => element('composer').focus()); await render(390);
    expect(document.activeElement).toBe(element('composer'));
});
it('Medium 1: a user open never moves focus into a docked drawer, including after resize', async () => {
    await render(1440); await click('ip-approvals-open');
    expect(document.activeElement).toBe(element('ip-approvals-open'));
    await act(async () => element('composer').focus()); await render(1000);
    expect(document.activeElement).toBe(element('composer'));
});
it('Low 6: DeskScreen follows the fullscreen boundary at 820 and 821 without remounting', async () => {
    await render(820); await click('ip-tab-waiting');
    const content = drawer()!;
    const placement = () => getComputedStyle(drawer()!.parentElement!).width;
    expect(placement()).toBe('100%');
    await render(821); expect(drawer()).toBe(content); expect(placement()).toBe('390px');
    await render(820); expect(drawer()).toBe(content); expect(placement()).toBe('100%');
});
it('Low 6: Escape from inside a docked drawer closes it and returns focus to Waiting', async () => {
    await render(1440); await click('ip-approvals-open');
    await act(async () => element('ip-approvals-close').focus()); await escape();
    expect(drawer()).toBeNull(); expect(document.activeElement).toBe(element('ip-approvals-open'));
});
it.each([1000, 1440])('Low 6: Escape from a non-editable chat target at %s returns focus to Waiting', async (width) => {
    await render(width); await click('ip-approvals-open');
    // Focus without an outside click, which would dismiss the clean overlay first.
    await act(async () => element('chat-action').focus()); await escape();
    expect(drawer()).toBeNull(); expect(document.activeElement).toBe(element('ip-approvals-open'));
});
it('Medium 2: DeskScreen protects all dirty cards until the last pick or text is sent or discarded', async () => {
    seedCards(); await render(); await click('ip-approvals-open');
    await click('pick-first'); await type('text-second', 'Unsent answer');
    await click('composer'); expect(drawer()).not.toBeNull();
    await click('send-first'); await click('composer'); expect(drawer()).not.toBeNull();
    await click('discard-second'); await click('composer'); expect(drawer()).toBeNull();
});
it('Medium 2: removing a dirty card releases outside-click protection through DeskScreen', async () => {
    seedCards(); await render(); await click('ip-approvals-open'); await click('pick-first');
    await click('composer'); expect(drawer()).not.toBeNull();
    await act(async () => seedCards(['second']));
    await click('composer'); expect(drawer()).toBeNull();
});
it('Medium 2: explicit close clears dirty state before the drawer is opened again', async () => {
    seedCards(); await render(); await click('ip-approvals-open'); await click('pick-first');
    await click('composer'); expect(drawer()).not.toBeNull();
    await click('ip-approvals-close'); await click('ip-approvals-open');
    await click('composer'); expect(drawer()).toBeNull();
});

it('shows desk chrome and phone panes at the agreed boundary', async () => {
    await render(1440);
    const bar = element('ip-top-bar');
    expect([...bar.children].map(node => node.getAttribute('data-testid'))).toEqual(['ip-top-sessions', 'ip-top-usage', 'ip-top-waiting', 'ip-top-settings']);
    expect(container.querySelectorAll('[data-testid="ip-approvals-open"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-testid="ip-settings-open"]')).toHaveLength(1);
    expect(element('ip-top-usage').textContent).toContain('not available');
    expect(element('ip-approvals-count').textContent).toBe('0');
    await render(390);
    expect(container.querySelector('[data-testid="ip-top-sessions"]')).toBeNull();
    expect(container.querySelector('[data-testid="ip-work"]')).toBeNull();
    await click('ip-tab-work');
    expect(element('ip-work')).toBeTruthy();
    expect(container.querySelector('[data-testid="composer"]')).toBeNull();
    await click('ip-tab-shog');
    expect(element('composer')).toBeTruthy();
    await render(820);
    expect(element('ip-tab-work')).toBeTruthy();
    expect(element('ip-tab-shog')).toBeTruthy();
    await click('ip-tab-waiting');
    expect(drawer()).not.toBeNull();
    expect(getComputedStyle(drawer()!.parentElement!).width).toBe('100%');
    await render(821);
    expect(container.querySelector('[data-testid="ip-tab-work"]')).toBeNull();
});


it('opens a searchable non-modal Sessions sheet and returns focus on Escape', async () => {
    storage.getState().applySessions([createSessionFixture({ id: 'worker', active: true })]);
    await render(1440);
    await click('ip-top-sessions');
    const sheet = element('ip-sessions-sheet');
    expect(sheet.getAttribute('aria-modal')).not.toBe('true');
    expect(sheet.textContent).toContain('Coordinator');
    expect(sheet.textContent).toContain('On issues');
    expect(sheet.textContent).toContain('No issue');
    expect(sheet.querySelectorAll('[data-testid="ip-sessions-row-coordinator"]')).toHaveLength(1);
    await type('ip-sessions-search', 'coordinator');
    expect(sheet.querySelector('[data-testid="ip-sessions-row-worker"]')).toBeNull();
    await escape();
    expect(container.querySelector('[data-testid="ip-sessions-sheet"]')).toBeNull();
    expect(document.activeElement).toBe(element('ip-top-sessions'));
});
