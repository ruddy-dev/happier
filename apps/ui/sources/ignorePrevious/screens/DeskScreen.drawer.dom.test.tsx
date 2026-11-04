/** @vitest-environment jsdom */
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Platform } from 'react-native';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createSessionFixture } from '@/dev/testkit/fixtures/sessionFixtures';
import { storage } from '@/sync/domains/state/storage';
import { lightTheme } from '@/theme';
import { t } from '@/text';
import type { WaitingItem } from '../model/waitingItems';
import { deskPrefs, getApprovalsOpen, setApprovalsOpen, setStoredCoordinatorId, setWorkCollapsed } from '../deskPrefs';
import { deskThemes } from '../palette';
import { DeskScreen } from './DeskScreen';

const routerHandle = vi.hoisted(() => ({ navigate: vi.fn() }));
const viewport = vi.hoisted(() => ({ width: 1000, height: 900, scale: 1, fontScale: 1 }));
vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    const web = await import('react-native-web');
    return createReactNativeWebMock({
        View: web.View, Pressable: web.Pressable, Text: web.Text, TextInput: web.TextInput, ScrollView: web.ScrollView,
        Animated: web.Animated, Easing: web.Easing, useWindowDimensions: () => viewport,
    });
});
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 23, left: 0 }) }));
vi.mock('@react-navigation/native', async () => {
    const { createReactNavigationNativeMock } = await import('@/dev/testkit/mocks/reactNavigation');
    return createReactNavigationNativeMock();
});
vi.mock('expo-router', async () => {
    const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
    return createExpoRouterMock({ pathname: '/desk', router: { navigate: routerHandle.navigate } }).module;
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
    routerHandle.navigate.mockClear();
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
    deskPrefs.set('chatStyle', 'mask'); deskPrefs.set('terminalPalette', 'tokyo');
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

it('keeps Work beside the coordinator at 900', async () => {
    await render(900);
    const work = element('ip-work');
    const coordinator = element('ip-coordinator-pane-wrapper');
    expect(work.parentElement!.parentElement).toBe(coordinator.parentElement);
    expect(getComputedStyle(coordinator.parentElement!).flexDirection).toBe('row');
    expect(getComputedStyle(work).width).toBe('330px');
    expect(getComputedStyle(coordinator).display).toBe('flex');
});

it('keeps the coordinator mounted through phone, column, rail and Waiting boundaries', async () => {
    await render(820);
    const composer = element('composer');
    expect(element('ip-tab-work')).toBeTruthy();
    for (const width of [821, 900, 1100, 1180, 1181]) {
        await render(width);
        expect(element('composer')).toBe(composer);
        const coordinator = element('ip-coordinator-pane-wrapper');
        expect(getComputedStyle(coordinator).display).toBe('flex');
        expect(getComputedStyle(coordinator.parentElement!).flexDirection).toBe('row');
        expect(getComputedStyle(element('ip-work')).width).toBe('330px');
        expect(container.querySelector('[data-testid="ip-tab-work"]')).toBeNull();
    }
    await render(821);
    await act(async () => element('ip-work-collapse').focus());
    expect(document.activeElement).toBe(element('ip-work-collapse'));
    await act(async () => element('ip-work-collapse').click());
    expect(getComputedStyle(element('ip-work-rail')).width).toBe('76px');
    expect(element('composer')).toBe(composer);
    expect(document.activeElement).toBe(element('ip-work-expand'));
    await act(async () => element('ip-work-expand').click());
    expect(getComputedStyle(element('ip-work')).width).toBe('330px');
    expect(document.activeElement).toBe(element('ip-work-collapse'));
    await render(820);
    expect(element('composer')).toBe(composer);
    expect(element('ip-tab-work')).toBeTruthy();
});

it('does not steal composer focus when the Work preference changes', async () => {
    await render(900);
    await act(async () => element('composer').focus());
    await act(async () => setWorkCollapsed(true));
    expect(document.activeElement).toBe(element('composer'));
    await act(async () => setWorkCollapsed(false));
    expect(document.activeElement).toBe(element('composer'));
});

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
    expect([...bar.children].map(node => node.getAttribute('data-testid'))).toEqual(['ip-top-brand', 'ip-top-sessions', 'ip-top-usage', 'ip-top-waiting', 'ip-top-settings']);
    expect(element('ip-top-brand').textContent).toContain('Ignore Previous');
    expect(container.querySelectorAll('[data-testid="ip-approvals-open"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-testid="ip-settings-open"]')).toHaveLength(1);
    expect(element('ip-top-usage-inline').textContent).toBe('Not available');
    expect(element('ip-approvals-count').textContent).toBe('0 requests');
    await render(390);
    expect(element('ip-top-sessions')).toBeTruthy();
    expect(getComputedStyle(element('ip-work').parentElement!).display).toBe('none');
    await click('ip-tab-work');
    expect(getComputedStyle(element('ip-tab-work')).borderTopWidth).toBe('2px');
    expect(element('ip-work')).toBeTruthy();
    expect(getComputedStyle(element('composer').closest('[data-testid="ip-coordinator-pane-wrapper"]')!).display).toBe('none');
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
    expect(sheet.querySelector('[data-testid="ip-sessions-row-worker"]')).not.toBeNull();
    await type('ip-sessions-search', 'coordinator');
    expect(sheet.querySelector('[data-testid="ip-sessions-row-worker"]')).toBeNull();
    await escape();
    expect(container.querySelector('[data-testid="ip-sessions-sheet"]')).toBeNull();
    expect(document.activeElement).toBe(element('ip-top-sessions'));
});

function seedSheetWorkers() {
    const base = createSessionFixture().metadata!;
    storage.getState().applySessions([
        createSessionFixture({ id: 'issued', active: true, metadata: { ...base, tag: 'ATR-6-build', summary: { text: 'Builder', updatedAt: 1 } } }),
        createSessionFixture({ id: 'unassigned', active: true, metadata: { ...base, name: 'Unassigned' } }),
    ]);
}

it('groups sheet rows by issue and keeps the coordinator separate', async () => {
    seedSheetWorkers(); await render(1440); await click('ip-top-sessions');
    const sheet = element('ip-sessions-sheet');
    const group = (heading: string) => [...sheet.querySelectorAll('[role="heading"]')].find(node => node.textContent === heading)!.parentElement!;
    expect(group('On issues').querySelector('[data-testid="ip-sessions-row-issued"]')?.textContent).toBe('ATR-6 Builder');
    expect(group('No issue').querySelector('[data-testid="ip-sessions-row-unassigned"]')).not.toBeNull();
    expect(group('Coordinator').querySelectorAll('[data-testid="ip-sessions-row-coordinator"]')).toHaveLength(1);
    expect(sheet.querySelectorAll('[data-testid="ip-sessions-row-coordinator"]')).toHaveLength(1);
});
it('searches sheet rows by issue key', async () => {
    seedSheetWorkers(); await render(1440); await click('ip-top-sessions');
    await type('ip-sessions-search', 'ATR-6');
    expect(element('ip-sessions-row-issued')).toBeTruthy();
    expect(container.querySelector('[data-testid="ip-sessions-row-unassigned"]')).toBeNull();
    expect(container.querySelector('[data-testid="ip-sessions-row-coordinator"]')).toBeNull();
});
it('closes the sheet and navigates when a session is selected', async () => {
    seedSheetWorkers(); await render(1440); await click('ip-top-sessions'); await click('ip-sessions-row-issued');
    expect(routerHandle.navigate).toHaveBeenCalledWith(expect.stringMatching(/^\/session\/issued(?:\?serverId=[^&]+)?$/), expect.objectContaining({ dangerouslySingular: expect.any(Function) }));
    expect(container.querySelector('[data-testid="ip-sessions-sheet"]')).toBeNull();
});


it.each([390, 820])('keeps phone top bar controls and accessible tabs at %i', async width => {
    await render(width);
    expect([...element('ip-top-bar').children].map(node => node.getAttribute('data-testid'))).toEqual(['ip-top-brand', 'ip-top-sessions', 'ip-top-usage', 'ip-top-settings']);
    expect(element('ip-top-brand').textContent).toContain('Ignore Previous');
    expect(container.querySelectorAll('[data-testid="ip-settings-open"]')).toHaveLength(1);
    expect(element('ip-tab-work').getAttribute('role')).toBe('tab');
    expect(element('ip-tab-waiting').getAttribute('role')).toBe('tab');
    expect(element('ip-tab-waiting').closest('[role="tablist"]')).not.toBeNull();
    expect(element('ip-tab-shog').getAttribute('aria-selected')).toBe('true');
});
it.each(['Enter', ' '])('activates phone tabs once on %j release and retains the draft', async key => {
    await render(820);
    const composer = element('composer') as HTMLInputElement;
    composer.value = 'Unsent draft';
    const press = async (id: string) => {
        const tab = element(id);
        await act(async () => tab.focus());
        expect(getComputedStyle(tab).borderTopWidth).toBe('2px');
        await act(async () => {
            tab.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
            tab.dispatchEvent(new KeyboardEvent('keydown', { key, repeat: true, bubbles: true, cancelable: true }));
        });
        expect(tab.getAttribute('aria-selected')).toBe('false');
        await act(async () => tab.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true, cancelable: true })));
        expect(tab.getAttribute('aria-selected')).toBe('true');
    };
    await press('ip-tab-work');
    await press('ip-tab-shog');
    expect(element('composer')).toBe(composer);
    expect(composer.value).toBe('Unsent draft');
    await press('ip-tab-waiting');
    expect(drawer()).not.toBeNull();
});
it('opens Waiting once when Space is released', async () => {
    await render(820);
    const tab = element('ip-tab-waiting');
    await act(async () => tab.focus());
    await act(async () => tab.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true })));
    expect(tab.getAttribute('aria-selected')).toBe('false');
    await act(async () => tab.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', bubbles: true, cancelable: true })));
    expect(tab.getAttribute('aria-selected')).toBe('true');
    expect(drawer()).not.toBeNull();
});
it('cancels a held tab Space on blur and does not activate from a repeat alone', async () => {
    await render(820);
    const work = element('ip-tab-work');
    await act(async () => work.focus());
    const down = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
    await act(async () => work.dispatchEvent(down));
    expect(down.defaultPrevented).toBe(true);
    await act(async () => element('ip-tab-shog').focus());
    await act(async () => work.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', bubbles: true, cancelable: true })));
    expect(work.getAttribute('aria-selected')).toBe('false');
    await act(async () => work.focus());
    await act(async () => work.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', repeat: true, bubbles: true, cancelable: true })));
    await act(async () => work.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', bubbles: true, cancelable: true })));
    expect(work.getAttribute('aria-selected')).toBe('false');
});
it('uses the selected desk palette for phone tabs and provides real focusable targets', async () => {
    deskPrefs.set('chatStyle', 'terminal'); deskPrefs.set('terminalPalette', 'tokyo');
    await render(390);
    const shog = element('ip-tab-shog');
    expect(shog.style.backgroundColor).toBe('rgb(192, 202, 245)');
    expect(getComputedStyle(shog).minHeight).toBe('48px');
    expect(getComputedStyle(element('ip-tab-work')).minHeight).toBe('48px');
    expect(getComputedStyle(element('ip-tab-waiting')).minHeight).toBe('48px');
    await click('ip-tab-work');
    expect(element('ip-tab-work').getAttribute('aria-selected')).toBe('true');
    expect(element('ip-tab-work').style.backgroundColor).toBe('rgb(192, 202, 245)');
    await act(async () => deskPrefs.set('terminalPalette', 'gruvbox'));
    const sample = document.createElement('span'); sample.style.backgroundColor = deskThemes.gruvbox.ink;
    expect(element('ip-tab-work').style.backgroundColor).toBe(sample.style.backgroundColor);
    await act(async () => deskPrefs.set('chatStyle', 'mask'));
    expect(element('ip-tab-work').style.backgroundColor).not.toBe('');
    deskPrefs.set('terminalPalette', 'tokyo');
});
it('keeps a populated Waiting tab within its share of the 390px bar and opens its drawer', async () => {
    await act(async () => seedCards(['first', 'second', 'third']));
    await render(390);
    const tab = element('ip-tab-waiting');
    expect(element('ip-approvals-count').textContent).toBe('3 requests');
    expect(tab.getAttribute('aria-label')).toContain('3 requests');
    expect(getComputedStyle(tab).flexGrow).toBe('1');
    expect(getComputedStyle(tab).flexBasis).toBe('0%');
    expect(getComputedStyle(tab).flexDirection).toBe('column');
    await click('ip-tab-waiting');
    expect(tab.getAttribute('aria-selected')).toBe('true');
    expect(element('ip-waiting-count').textContent).toBe('3 requests');
    await click('ip-approvals-close');
    expect(document.activeElement).toBe(tab);
});
it.each([
    { width: 390, style: 'terminal' as const }, { width: 1440, style: 'terminal' as const },
    { width: 390, style: 'mask' as const }, { width: 1440, style: 'mask' as const },
])('R41: full DeskScreen exposes unavailable Usage rows and returns focus at $width in $style', async ({ width, style }) => {
    deskPrefs.set('chatStyle', style);
    await render(width);
    const usage = element('ip-top-usage');
    expect(usage.getAttribute('aria-label')).toContain('Usage');
    expect(usage.getAttribute('aria-label')).toContain('Not available');
    if (width > 820) expect(element('ip-top-usage-inline').textContent).toBe('Not available');
    expect(element('ip-top-brand-mask').querySelector('svg')).not.toBeNull();
    expect(element('ip-top-bar').textContent).not.toContain('%');
    await click('ip-top-usage');
    const panel = document.querySelector<HTMLElement>('[data-testid="ip-usage-popover"]')!;
    expect(panel.getAttribute('role')).toBe('dialog');
    for (const id of ['maxWeek', 'lastFiveHours', 'fableShare'] as const) {
        const row = panel.querySelector<HTMLElement>(`[data-testid="ip-usage-row-${id}"]`)!;
        expect(row.textContent).toContain(t(`ignorePrevious.usage.${id}`));
        expect(row.textContent).toContain(t('ignorePrevious.usage.notAvailable'));
        if (id === 'fableShare') expect(row.textContent).toContain(t('ignorePrevious.usage.estimate'));
    }
    expect(panel.textContent).not.toMatch(/[\d%]/);
    await act(async () => panel.querySelector<HTMLElement>('[data-testid="ip-usage-close"]')!.click());
    expect(document.querySelector('[data-testid="ip-usage-popover"]')).toBeNull();
    expect(document.activeElement).toBe(usage);
});
it('R41: changing the selected session never attributes its context reading to account usage', async () => {
    const reported = createSessionFixture({ id: 'reported-worker', active: true, latestUsage: {
        inputTokens: 1200, outputTokens: 300, cacheCreation: 0, cacheRead: 0,
        contextSize: 1500, contextSizeIsReported: true, contextWindowTokens: 200_000, timestamp: 1,
    } });
    const unreported = createSessionFixture({ id: 'unreported-worker', active: true });
    storage.getState().applySessions([reported, unreported]);
    setStoredCoordinatorId(reported.id);
    await render(1440);
    expect(element('ip-top-usage-inline').textContent).toBe('Not available');
    await click('ip-top-usage');
    const panel = document.querySelector<HTMLElement>('[data-testid="ip-usage-popover"]');
    expect(panel).not.toBeNull();
    expect(panel?.textContent).not.toMatch(/[\d%]/);
    await act(async () => setStoredCoordinatorId(unreported.id));
    expect(element('ip-top-usage-inline').textContent).toBe('Not available');
    expect(document.querySelector('[data-testid="ip-usage-popover"]')).toBe(panel);
    expect(panel?.textContent).not.toMatch(/[\d%]/);
    expect(storage.getState().sessions[reported.id]?.latestUsage?.contextSize).toBe(1500);
    expect(storage.getState().sessions[unreported.id]?.latestUsage).toBeFalsy();
});
it.each([320, 390, 821, 1100, 1440])('R41: Sessions, Waiting and Settings remain operable at %i', async width => {
    await render(width);
    await click('ip-top-sessions');
    expect(element('ip-sessions-sheet')).toBeTruthy();
    await escape();
    const waitingId = width <= 820 ? 'ip-tab-waiting' : 'ip-approvals-open';
    expect(element(waitingId).getAttribute('aria-label')).toBe(t('ignorePrevious.openApprovals', { count: 0 }));
    await click(waitingId);
    expect(drawer()).not.toBeNull();
    await escape();
    await click('ip-settings-open');
    expect(routerHandle.navigate).toHaveBeenCalledWith('/desk/settings');
});
it('R10/R24: top-bar Waiting excludes view-only requests and counts unloaded details', async () => {
    seedCards(['first']);
    storage.getState().applySessions([
        createSessionFixture({ id: 'viewer', active: true, accessLevel: 'view', canApprovePermissions: false,
            agentState: { requests: { hidden: { tool: 'Bash', arguments: { command: 'pwd' }, createdAt: 1 } } } }),
        createSessionFixture({ id: 'unloaded', active: true, pendingPermissionRequestCount: 1 }),
    ]);
    await render(1440);
    expect(element('ip-approvals-count').textContent).toBe('2 requests');
    await click('ip-approvals-open');
    expect(drawer()).not.toBeNull();
});
it('uses a muted zero while preserving the waiting label', async () => {
    await render(1440);
    const zero = getComputedStyle(element('ip-approvals-count')).color;
    const token = document.createElement('span'); token.style.color = lightTheme.colors.text.secondary; document.body.append(token);
    expect(zero).toBe(getComputedStyle(token).color); token.remove();
    const label = element('ip-approvals-open').textContent!.replace(element('ip-approvals-count').textContent!, '');
    await act(async () => seedCards(['first']));
    expect(getComputedStyle(element('ip-approvals-count')).color).not.toBe(zero);
    expect(element('ip-approvals-open').textContent!.replace(element('ip-approvals-count').textContent!, '')).toBe(label);
});
it('returns focus to the current waiting opener after crossing the boundary', async () => {
    await render(1000); await click('ip-approvals-open'); await render(820); await escape();
    expect(document.activeElement).toBe(element('ip-tab-waiting'));
});
it('preserves the coordinator node across phone pane switches', async () => {
    await render(390); const composer = element('composer');
    await click('ip-tab-work'); await click('ip-tab-shog');
    expect(element('composer')).toBe(composer);
});
it('closes the sessions sheet when crossing the phone boundary', async () => {
    await render(1440); await click('ip-top-sessions'); await render(390); await render(1440);
    expect(container.querySelector('[data-testid="ip-sessions-sheet"]')).toBeNull();
});
it('shows the full Work list on phone despite a collapsed preference', async () => {
    setWorkCollapsed(true); await render(390); await click('ip-tab-work');
    expect(element('ip-work')).toBeTruthy();
    expect(container.querySelector('[data-testid="ip-work-rail"]')).toBeNull();
    expect(container.querySelector('[data-testid="ip-work-collapse"]')).toBeNull();
    expect(container.querySelector('[data-testid="ip-work-expand"]')).toBeNull();
});

it('exposes a tablist with selected states and bottom safe area', async () => {
    await render(390);
    const waiting = element('ip-tab-waiting');
    const tablist = waiting.closest('[role="tablist"]');
    expect(tablist).not.toBeNull();
    expect(waiting.getAttribute('role')).toBe('tab');
    expect(waiting.getAttribute('aria-selected')).toBe('false');
    expect(getComputedStyle(tablist!).paddingBottom).toBe('0px');
    await click('ip-tab-waiting');
    expect(element('ip-tab-waiting').getAttribute('aria-selected')).toBe('true');
});

it('opens Sessions from the phone bar', async () => {
    await render(390); await click('ip-top-sessions');
    expect(element('ip-sessions-sheet')).toBeTruthy();
});
it('closes the phone Sessions sheet and returns focus to its opener', async () => {
    await render(390); await click('ip-top-sessions');
    const close = element('ip-sessions-close');
    expect(close.getAttribute('aria-label')).toBeTruthy();
    expect(element('ip-sessions-sheet').contains(close)).toBe(true);
    await click('ip-sessions-close');
    expect(container.querySelector('[data-testid="ip-sessions-sheet"]')).toBeNull();
    expect(document.activeElement).toBe(element('ip-top-sessions'));
});
it.each([390, 820])('navigates to desk Settings at %i', async width => {
    await render(width); await click('ip-settings-open');
    expect(routerHandle.navigate).toHaveBeenCalledWith('/desk/settings');
});
it.each([820, 821])('returns focus to the live Waiting opener after explicit close from %i', async width => {
    await render(width); await click(width === 820 ? 'ip-tab-waiting' : 'ip-approvals-open');
    await render(width === 820 ? 821 : 820); await click('ip-approvals-close');
    expect(drawer()).toBeNull();
    expect(document.activeElement).toBe(element(width === 820 ? 'ip-approvals-open' : 'ip-tab-waiting'));
});
it('returns focus to the desk opener when the drawer crosses from phone', async () => {
    await render(820); await click('ip-tab-waiting'); await render(821); await escape();
    expect(document.activeElement).toBe(element('ip-approvals-open'));
});

it('pads the native phone tabs by the safe-area inset', async () => {
    const platform = Platform.OS;
    try {
        Platform.OS = 'ios'; await render(390);
        expect(getComputedStyle(element('ip-tab-waiting').closest('[role="tablist"]')!).paddingBottom).toBe('23px');
    } finally { Platform.OS = platform; }
});
