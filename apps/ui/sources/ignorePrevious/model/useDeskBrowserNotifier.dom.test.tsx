/** @vitest-environment jsdom */
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSessionFixture } from '@/dev/testkit';
import { storage } from '@/sync/domains/state/storage';
import { deskPrefs } from '../deskPrefs';
import { DeskBrowserNotifier, useDeskBrowserNotifier } from './useDeskBrowserNotifier';
import * as waitingItems from './waitingItems';

const platform = vi.hoisted(() => ({ os: 'web' }));
vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock({ Platform: { get OS() { return platform.os; } } });
});

class BrowserNotification {
    static permission: NotificationPermission = 'granted';
    static instances: BrowserNotification[] = [];
    static requestPermission = vi.fn();
    onclick: (() => void) | null = null;
    close = vi.fn();
    constructor(public title: string, public options?: NotificationOptions) {
        BrowserNotification.instances.push(this);
    }
}

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let previous: ReturnType<typeof storage.getState>;
beforeEach(() => {
    previous = storage.getState();
    storage.setState({ sessions: {}, sessionListRenderables: {}, sessionMessages: {}, isDataReady: false });
    root = createRoot(document.createElement('div'));
    platform.os = 'web';
    BrowserNotification.permission = 'granted';
    BrowserNotification.instances = [];
    BrowserNotification.requestPermission.mockClear();
    vi.stubGlobal('Notification', BrowserNotification);
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    vi.spyOn(window, 'focus').mockImplementation(() => {});
});
afterEach(() => {
    act(() => root.unmount());
    storage.setState(previous, true);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

function worker(id: string, ids: string[] = [], thinking = false) {
    const old = storage.getState().sessions[id];
    const now = Date.now();
    act(() => storage.getState().applySessions([createSessionFixture({
        id, active: true, activeAt: now, updatedAt: now, thinking, thinkingAt: now,
        metadata: { path: '/tmp/desk-worker', host: 'test-host', flavor: 'claude' },
        agentStateVersion: (old?.agentStateVersion ?? 0) + 1,
        agentState: { requests: Object.fromEntries(ids.map(requestId => [requestId, {
            tool: 'Bash', arguments: { command: 'private work detail' }, createdAt: now,
        }])) },
        pendingPermissionRequestCount: ids.length, pendingUserActionRequestCount: 0,
    })]));
}
function ready() { act(() => storage.getState().applyReady()); }
function mount() { act(() => root.render(<DeskBrowserNotifier coordinatorId="coordinator" />)); }

describe('desk browser notifier', () => {
    it('sends only the private title and replacement tag for a hidden new wait, and click focuses and closes', () => {
        ready();
        mount();
        worker('worker', ['one']);
        expect(BrowserNotification.instances).toHaveLength(1);
        const notice = BrowserNotification.instances[0]!;
        expect(notice.title).toBe('Waiting on you');
        expect(notice.options).toEqual({ tag: 'ip-waiting' });
        act(() => notice.onclick?.());
        expect(window.focus).toHaveBeenCalledOnce();
        expect(notice.close).toHaveBeenCalledOnce();
        worker('worker', ['one', 'two']);
        expect(BrowserNotification.instances).toHaveLength(1);
    });

    it('every notices replacement ids at the same count and removal followed by reappearance', () => {
        deskPrefs.set('deskNotify', 'every');
        ready();
        mount();
        worker('worker', ['one']);
        worker('worker', ['two']);
        worker('worker', ['two']);
        worker('worker');
        worker('worker', ['two']);
        expect(BrowserNotification.instances).toHaveLength(3);
    });

    it('blocked waits for workers to stop, can reenter, and excludes the coordinator from worker bulbs', () => {
        worker('busy', [], true);
        worker('coordinator', [], true);
        ready();
        mount();
        worker('worker', ['one']);
        expect(BrowserNotification.instances).toHaveLength(0);
        worker('busy');
        expect(BrowserNotification.instances).toHaveLength(1);
        worker('busy', [], true);
        worker('busy');
        expect(BrowserNotification.instances).toHaveLength(2);
    });

    it.each(['every', 'blocked'] as const)('%s does not alert for existing items or initial readiness', setting => {
        deskPrefs.set('deskNotify', setting);
        worker('worker', ['one']);
        mount();
        expect(BrowserNotification.instances).toHaveLength(0);
        ready();
        worker('worker', ['one']);
        expect(BrowserNotification.instances).toHaveLength(0);
        act(() => root.unmount());
        root = createRoot(document.createElement('div'));
        mount();
        expect(BrowserNotification.instances).toHaveLength(0);
    });

    it.each([
        { visibility: 'visible', focus: true, count: 0 },
        { visibility: 'visible', focus: false, count: 1 },
        { visibility: 'hidden', focus: true, count: 1 },
    ] as const)('visibility=$visibility focus=$focus yields $count alerts', ({ visibility, focus, count }) => {
        vi.mocked(document.hasFocus).mockReturnValue(focus);
        vi.spyOn(document, 'visibilityState', 'get').mockReturnValue(visibility);
        ready();
        mount();
        worker('worker', ['one']);
        expect(BrowserNotification.instances).toHaveLength(count);
        vi.mocked(document.hasFocus).mockReturnValue(false);
        worker('worker', ['one']);
        expect(BrowserNotification.instances).toHaveLength(count);
    });

    it.each(['default', 'denied', 'unsupported', 'native'] as const)('does not alert or prompt with %s permission/support', permission => {
        if (permission === 'unsupported') vi.stubGlobal('Notification', undefined);
        else if (permission === 'native') platform.os = 'ios';
        else BrowserNotification.permission = permission;
        ready();
        mount();
        worker('worker', ['one']);
        expect(BrowserNotification.instances).toHaveLength(0);
        expect(BrowserNotification.requestPermission).not.toHaveBeenCalled();
    });

    it('a live preference change affects the next request without replaying existing waits', () => {
        worker('busy', [], true);
        ready();
        mount();
        worker('worker', ['one']);
        act(() => deskPrefs.set('deskNotify', 'every'));
        expect(BrowserNotification.instances).toHaveLength(0);
        worker('worker', ['one', 'two']);
        expect(BrowserNotification.instances).toHaveLength(1);
    });

    it('keeps the subscription stable on unrelated writes without building Waiting card details or rerendering the desk', () => {
        ready();
        let deskRenders = 0;
        let notifierRenders = 0;
        function Notifier() { useDeskBrowserNotifier(null); notifierRenders++; return null; }
        function Desk() { deskRenders++; return <Notifier />; }
        const details = vi.spyOn(waitingItems, 'toWaitingItems');
        act(() => root.render(<Desk />));
        const baseline = notifierRenders;
        act(() => storage.setState({ isDataReady: true }));
        expect(notifierRenders).toBe(baseline);
        worker('worker', ['one']);
        expect(BrowserNotification.instances).toHaveLength(1);
        expect(deskRenders).toBe(1);
        expect(details).not.toHaveBeenCalled();
    });
});
