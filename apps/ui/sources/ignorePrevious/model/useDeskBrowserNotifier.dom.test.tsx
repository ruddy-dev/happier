/** @vitest-environment jsdom */
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSessionFixture } from '@/dev/testkit';
import { storage } from '@/sync/domains/state/storage';
import type { NormalizedMessage } from '@/sync/typesRaw';
import { buildSessionListRenderableFromSession } from '@/sync/domains/session/listing/sessionListRenderable';
import { SESSION_RUNTIME_STATUS_STALE_SIGNAL_MS } from '@/sync/domains/session/attention/deriveSessionRuntimePresentationState';
import { getSessionStatus } from '@/utils/sessions/sessionUtils';
import { readNowMs } from '@/hooks/time/nowMsClockStore';
import { deskPrefs } from '../deskPrefs';
import { DESK_TICK_MS } from './useDeskNow';
import { DeskBrowserNotifier, useDeskBrowserNotifier } from './useDeskBrowserNotifier';
import { readDeskWaits } from './useDeskWaits';
import * as waitingItems from './waitingItems';

const platform = vi.hoisted(() => ({ os: 'web' }));
vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock({ Platform: { get OS() { return platform.os; } } });
});

// Navigation is the external boundary; the real desk clock and session store stay active.
vi.mock('@react-navigation/native', async () => {
    const { createReactNavigationNativeMock } = await import('@/dev/testkit/mocks/reactNavigation');
    return createReactNavigationNativeMock();
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
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    previous = storage.getState();
    storage.setState({ sessions: {}, sessionListRenderables: {}, sessionMessages: {}, isDataReady: false });
    storage.getState().setSocketStatus('connected');
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
    vi.useRealTimers();
});

function worker(id: string, ids: string[] = [], thinking = false, access: Pick<NonNullable<Parameters<typeof createSessionFixture>[0]>, 'accessLevel' | 'canApprovePermissions'> = {}) {
    const old = storage.getState().sessions[id];
    const now = Date.now();
    act(() => {
        storage.getState().applySessions([createSessionFixture({
        id, active: true, activeAt: now, updatedAt: now, thinking, thinkingAt: now, ...access,
        metadata: { path: '/tmp/desk-worker', host: 'test-host', flavor: 'claude' },
        agentStateVersion: (old?.agentStateVersion ?? 0) + 1,
        agentState: { requests: Object.fromEntries(ids.map(requestId => [requestId, {
            tool: 'Bash', arguments: { command: 'private work detail' }, createdAt: now,
        }])) },
        pendingPermissionRequestCount: ids.length, pendingUserActionRequestCount: 0,
        })]);
        storage.getState().applyMessagesLoaded(id);
    });
}
function ready() { act(() => storage.getState().applyReady()); }
function mount() { act(() => root.render(<DeskBrowserNotifier coordinatorId="coordinator" />)); }

function unloadedWorker(id: string, access: Pick<NonNullable<Parameters<typeof createSessionFixture>[0]>, 'accessLevel' | 'canApprovePermissions'> = {}) {
    act(() => storage.getState().mergeSessionListRenderables([buildSessionListRenderableFromSession(createSessionFixture({
        id, active: true, activeAt: Date.now(), updatedAt: Date.now(), ...access,
        metadata: { path: '/tmp/desk-worker', host: 'test-host', flavor: 'claude' },
        pendingPermissionRequestCount: 1, pendingUserActionRequestCount: 0,
    }))]));
}

function transcriptWaits(ids: string[], loaded: boolean) {
    const messages: NormalizedMessage[] = ids.map((id, index) => ({
        id: `message-${id}`, localId: null, createdAt: index + 100,
        role: 'agent', isSidechain: false,
        content: [{ type: 'tool-call', id, name: 'bash',
            input: { permissionId: id, status: 'pending', command: 'echo ready' },
            description: null, uuid: `message-${id}`, parentUUID: null }],
    }));
    act(() => {
        storage.getState().applyMessages('worker', messages);
        if (loaded) storage.getState().applyMessagesLoaded('worker');
    });
}

function waitingRecord() {
    act(() => storage.getState().applySessions([createSessionFixture({ id: 'worker', active: true,
        activeAt: Date.now(), metadata: { path: '/tmp/desk-worker', host: 'test-host', flavor: 'claude' },
        pendingPermissionRequestCount: 2, pendingUserActionRequestCount: 0, agentState: {},
    })]));
}

describe('desk browser notifier', () => {
    it.each(['every', 'blocked'] as const)('R10/R24: %s alerts for editable/no-approval waits but not view-only waits', setting => {
        deskPrefs.set('deskNotify', setting);
        ready();
        mount();
        const sharedWait = createSessionFixture({ id: 'viewer', active: true, activeAt: Date.now(),
            accessLevel: 'view', canApprovePermissions: false, pendingPermissionRequestCount: 1,
            agentState: { requests: { request: { tool: 'Bash', arguments: { command: 'pwd' }, createdAt: Date.now() } } },
        });
        act(() => {
            storage.getState().applySessions([sharedWait]);
            storage.getState().mergeSessionListRenderables([buildSessionListRenderableFromSession({ ...sharedWait, id: 'viewer-unloaded' })]);
        });
        expect(BrowserNotification.instances).toHaveLength(0);
        const editor = { ...sharedWait, id: 'editor-unloaded', accessLevel: 'edit' as const };
        act(() => storage.getState().mergeSessionListRenderables([buildSessionListRenderableFromSession(editor)]));
        expect(BrowserNotification.instances).toHaveLength(1);
        // Details replace an already alerted placeholder without a duplicate alert.
        act(() => storage.getState().applySessions([editor]));
        expect(BrowserNotification.instances).toHaveLength(1);
        act(() => storage.getState().applySessions([{ ...editor, id: 'editor-loaded' }]));
        expect(BrowserNotification.instances).toHaveLength(setting === 'every' ? 2 : 1);
    });

    it('R10: a view-only unloaded row cannot absorb the first alert after gaining edit access without approval', () => {
        deskPrefs.set('deskNotify', 'every');
        const viewer = createSessionFixture({ id: 'viewer', active: true, activeAt: Date.now(),
            accessLevel: 'view', canApprovePermissions: false, pendingPermissionRequestCount: 1,
        });
        act(() => storage.getState().mergeSessionListRenderables([buildSessionListRenderableFromSession(viewer)]));
        ready();
        mount();
        expect(BrowserNotification.instances).toHaveLength(0);
        act(() => storage.getState().mergeSessionListRenderables([
            buildSessionListRenderableFromSession({ ...viewer, accessLevel: 'edit' }),
        ]));
        expect(BrowserNotification.instances).toHaveLength(1);
    });

    it.each([
        ['every', 'loaded'], ['every', 'unloaded'],
        ['blocked', 'loaded'], ['blocked', 'unloaded'],
    ] as const)('R10: %s excludes %s view-only alerts while preserving readable waits and notGranted admission', (setting, source) => {
        deskPrefs.set('deskNotify', setting);
        ready();
        mount();
        const putWait = (access: { accessLevel: 'view' | 'edit'; canApprovePermissions: boolean }) => {
            if (source === 'loaded') worker('viewer', ['one'], false, access);
            else unloadedWorker('viewer', access);
        };
        putWait({ accessLevel: 'view', canApprovePermissions: false });
        const waits = readDeskWaits();
        expect(waits.count).toBe(0);
        if (source === 'loaded') {
            expect(waits.items).toMatchObject([{ sessionId: 'viewer', disabledReason: 'readOnly', detail: 'private work detail' }]);
        } else {
            expect(waits.unloaded).toMatchObject([{ sessionId: 'viewer' }]);
        }
        expect(BrowserNotification.instances).toHaveLength(0);
        // R10 excludes readOnly specifically, rather than every disabled approval.
        putWait({ accessLevel: 'edit', canApprovePermissions: false });
        expect(readDeskWaits().count).toBe(1);
        if (source === 'loaded') expect(readDeskWaits().items[0]?.disabledReason).toBe('notGranted');
        expect(BrowserNotification.instances).toHaveLength(1);
        putWait({ accessLevel: 'edit', canApprovePermissions: true });
        expect(BrowserNotification.instances).toHaveLength(1);
    });

    it('rechecks a hidden thinking worker without a store write or desk clock tick and alerts once', () => {
        worker('busy', [], true);
        worker('worker', ['one']);
        ready();
        mount();
        const before = storage.getState();
        const deskNow = readNowMs(DESK_TICK_MS);
        act(() => vi.advanceTimersByTime(SESSION_RUNTIME_STATUS_STALE_SIGNAL_MS - 1));
        expect(BrowserNotification.instances).toHaveLength(0);
        act(() => vi.advanceTimersByTime(30_001));
        expect(storage.getState()).toBe(before);
        expect(readNowMs(DESK_TICK_MS)).toBe(deskNow);
        expect(getSessionStatus(before.sessionListRenderables.busy!, Date.now()).state).not.toBe('thinking');
        expect(BrowserNotification.instances).toHaveLength(1);
        act(() => vi.advanceTimersByTime(30_000));
        expect(BrowserNotification.instances).toHaveLength(1);
    });

    it('owns one hidden interval and clears it on focus, preference change, no waits and unmount', () => {
        const intervals = vi.spyOn(globalThis, 'setInterval');
        const clears = vi.spyOn(globalThis, 'clearInterval');
        ready();
        mount();
        const rechecks = () => intervals.mock.calls.filter(([, delay]) => delay === 30_000);
        const lastRecheckHandle = () => intervals.mock.results[
            intervals.mock.calls.map(([, delay]) => delay).lastIndexOf(30_000)
        ]!.value;
        expect(rechecks()).toHaveLength(0);
        worker('worker', ['one']);
        expect(rechecks()).toHaveLength(1);
        const handle = intervals.mock.results[intervals.mock.calls.findIndex(([, delay]) => delay === 30_000)]!.value;
        vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
        vi.mocked(document.hasFocus).mockReturnValue(true);
        act(() => document.dispatchEvent(new Event('visibilitychange')));
        expect(clears).toHaveBeenCalledWith(handle);
        const focusedCount = rechecks().length;
        worker('worker', ['one', 'two']);
        expect(rechecks()).toHaveLength(focusedCount);
        vi.mocked(document.hasFocus).mockReturnValue(false);
        act(() => window.dispatchEvent(new Event('blur')));
        expect(rechecks()).toHaveLength(focusedCount + 1);
        const blurredHandle = lastRecheckHandle();
        act(() => deskPrefs.set('deskNotify', 'every'));
        expect(clears).toHaveBeenCalledWith(blurredHandle);
        const everyCount = rechecks().length;
        worker('worker', ['three']);
        expect(rechecks()).toHaveLength(everyCount);
        act(() => deskPrefs.set('deskNotify', 'blocked'));
        expect(rechecks()).toHaveLength(everyCount + 1);
        const blockedHandle = lastRecheckHandle();
        worker('worker');
        expect(clears).toHaveBeenCalledWith(blockedHandle);
        const noWaitCount = rechecks().length;
        act(() => window.dispatchEvent(new Event('blur')));
        expect(rechecks()).toHaveLength(noWaitCount);
        worker('worker', ['four']);
        act(() => root.unmount());
        root = createRoot(document.createElement('div'));
        for (const [index, [, delay]] of intervals.mock.calls.entries()) {
            if (delay === 30_000) expect(clears).toHaveBeenCalledWith(intervals.mock.results[index]!.value);
        }
    });

    it.each(['unsupported', 'native'] as const)('does not start a hidden interval on %s', support => {
        if (support === 'native') platform.os = 'ios';
        else vi.stubGlobal('Notification', undefined);
        const intervals = vi.spyOn(globalThis, 'setInterval');
        worker('worker', ['one']);
        ready();
        mount();
        expect(intervals.mock.calls.filter(([, delay]) => delay === 30_000)).toHaveLength(0);
    });

    it('every absorbs placeholder and staged transcript requests, then alerts once after fully read', () => {
        deskPrefs.set('deskNotify', 'every');
        unloadedWorker('worker');
        ready();
        mount();
        // Both requests predate the baseline. The transcript exposes them in separate snapshots.
        waitingRecord();
        transcriptWaits(['one'], false);
        expect(storage.getState().sessionMessages.worker?.isLoaded).toBe(false);
        expect(BrowserNotification.instances).toHaveLength(0);
        transcriptWaits(['two'], true);
        expect(BrowserNotification.instances).toHaveLength(0);
        transcriptWaits(['three'], true);
        expect(BrowserNotification.instances).toHaveLength(1);
        transcriptWaits(['three'], true);
        expect(BrowserNotification.instances).toHaveLength(1);
    });

    it('every stops absorbing requests in a session whose transcript stays unloaded for over 60 seconds', () => {
        deskPrefs.set('deskNotify', 'every');
        unloadedWorker('worker');
        ready();
        mount();
        act(() => vi.advanceTimersByTime(30_000));
        waitingRecord();
        transcriptWaits(['old'], false);
        expect(BrowserNotification.instances).toHaveLength(0);
        act(() => vi.advanceTimersByTime(30_001));
        worker('worker', ['new']);
        expect(BrowserNotification.instances).toHaveLength(1);
    });

    it('does not rearm a hidden stale worker on an unrelated store write after a recheck', () => {
        worker('busy', [], true);
        worker('worker', ['one']);
        ready();
        mount();
        act(() => vi.advanceTimersByTime(SESSION_RUNTIME_STATUS_STALE_SIGNAL_MS + 30_000));
        expect(BrowserNotification.instances).toHaveLength(1);
        act(() => storage.setState({ isDataReady: true }));
        act(() => vi.advanceTimersByTime(30_000));
        expect(BrowserNotification.instances).toHaveLength(1);
    });
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

    it('blocked alerts when a thinking signal ages out on the desk clock with no store write', () => {
        // The shared clock runs in a visible tab; an unfocused window still permits an alert.
        vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
        worker('busy', [], true);
        worker('worker', ['one']);
        ready();
        mount();
        const before = storage.getState();
        expect(getSessionStatus(before.sessionListRenderables.busy!, readNowMs(DESK_TICK_MS)).state).toBe('thinking');
        act(() => vi.advanceTimersByTime(SESSION_RUNTIME_STATUS_STALE_SIGNAL_MS - DESK_TICK_MS));
        expect(BrowserNotification.instances).toHaveLength(0);
        act(() => vi.advanceTimersByTime(2 * DESK_TICK_MS));
        expect(storage.getState()).toBe(before);
        expect(getSessionStatus(before.sessionListRenderables.busy!, Date.now()).state).not.toBe('thinking');
        expect(BrowserNotification.instances).toHaveLength(1);
        act(() => vi.advanceTimersByTime(DESK_TICK_MS));
        expect(BrowserNotification.instances).toHaveLength(1);
    });

    it.each(['every', 'blocked'] as const)('%s baselines an unloaded wait and never alerts when its details arrive later', setting => {
        deskPrefs.set('deskNotify', setting);
        unloadedWorker('worker');
        mount();
        ready();
        expect(BrowserNotification.instances).toHaveLength(0);
        worker('worker', ['one', 'two']);
        expect(BrowserNotification.instances).toHaveLength(0);
    });

    it.each(['every', 'blocked'] as const)('%s alerts for a new unloaded wait once, then suppresses its loaded details', setting => {
        deskPrefs.set('deskNotify', setting);
        ready();
        mount();
        unloadedWorker('worker');
        expect(BrowserNotification.instances).toHaveLength(1);
        worker('worker', ['one']);
        expect(BrowserNotification.instances).toHaveLength(1);
    });

    it('a shared clock tick with unchanged bulbs keeps the snapshot and desk render stable', () => {
        vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
        worker('busy', [], true);
        ready();
        let deskRenders = 0;
        function Desk() { deskRenders++; return <DeskBrowserNotifier coordinatorId={null} />; }
        act(() => root.render(<Desk />));
        const baseline = deskRenders;
        const before = readNowMs(DESK_TICK_MS);
        act(() => vi.advanceTimersByTime(DESK_TICK_MS));
        expect(readNowMs(DESK_TICK_MS)).toBe(before + DESK_TICK_MS);
        expect(deskRenders).toBe(baseline);
        expect(BrowserNotification.instances).toHaveLength(0);
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
