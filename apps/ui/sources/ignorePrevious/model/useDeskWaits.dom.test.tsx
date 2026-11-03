/** @vitest-environment jsdom */
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createSessionFixture } from '@/dev/testkit/fixtures/sessionFixtures';
import { buildSessionListRenderableFromSession } from '@/sync/domains/session/listing/sessionListRenderable';
import { storage } from '@/sync/domains/state/storage';
import type { NormalizedMessage } from '@/sync/typesRaw';
import * as waitingItems from './waitingItems';
import * as sessionUtils from '@/utils/sessions/sessionUtils';
import * as transcriptReader from '@/sync/domains/messages/readStoredSessionMessages';
import { readDeskWaits, selectDeskNotificationWaits, useDeskWaits, useDeskWaitsSummary, useDeskWaitsActivity, useWaitingCount } from './useDeskWaits';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
let previous: ReturnType<typeof storage.getState>;
beforeEach(() => {
    previous = storage.getState();
    container = document.createElement('div');
    root = createRoot(container);
    act(() => {
        storage.getState().applySessions(['waiting', 'streaming'].map((id) => createSessionFixture({
            id, active: true, agentState: {},
            ...(id === 'streaming' ? { pendingPermissionRequestCount: 0, pendingUserActionRequestCount: 0 } : {}),
        })));
        storage.getState().applyReady();
    });
});
afterEach(() => {
    act(() => root.unmount());
    storage.setState(previous, true);
    vi.restoreAllMocks();
});
function write(id: string, index: number, pending = false) {
    const message: NormalizedMessage = {
        id: `message-${index}`, localId: null, createdAt: index + 100,
        role: 'agent', isSidechain: false,
        content: pending ? [{ type: 'tool-call', id: `request-${index}`, name: 'bash',
            input: { permissionId: `request-${index}`, status: 'pending', command: 'echo ready' },
            description: null, uuid: `message-${index}`, parentUUID: null,
        }] : [{ type: 'text', text: `Working ${index}`, uuid: `message-${index}`, parentUUID: null }],
    };
    act(() => storage.getState().applyMessages(id, [message]));
}

it('keeps closed counts stable without building details during one streaming worker', () => {
    let renders = 0;
    const values: number[] = [];
    function Badge() {
        const count = useWaitingCount();
        renders++;
        values.push(count);
        return <span>{count}</span>;
    }
    const details = vi.spyOn(waitingItems, 'toWaitingItems');
    act(() => root.render(<><Badge /><Badge /></>));
    const initialRenders = renders;
    details.mockClear();
    const reads = vi.spyOn(transcriptReader, 'readStoredSessionMessagesFromStateLike');
    const labels = vi.spyOn(sessionUtils, 'getSessionName');
    for (let i = 0; i < 10; i++) write('streaming', i);
    console.log(JSON.stringify({ workload: 'two closed count consumers, ten worker writes', renders: renders - initialRenders, detailBuilds: details.mock.calls.length, transcriptReads: reads.mock.calls.length }));
    expect(values.every((value) => Object.is(value, values[0]))).toBe(true);
    expect(renders).toBe(initialRenders);
    expect(details).not.toHaveBeenCalled();
    expect(reads).not.toHaveBeenCalled();
    expect(labels).not.toHaveBeenCalled();
});

it('shares details across open readers, sees a new request, and refreshes after reopening', () => {
    function Badge() { return <span data-count>{useWaitingCount()}</span>; }
    function Drawer() {
        const waits = useDeskWaits();
        return <div data-detail>{waits.items.map((item) => item.requestId).join(',')}</div>;
    }
    act(() => root.render(<Badge />));
    write('waiting', 50, true);
    expect(container.querySelector('[data-count]')?.textContent).toBe('1');
    const details = vi.spyOn(waitingItems, 'toWaitingItems');
    act(() => root.render(<><Badge /><Drawer /><Drawer /></>));
    expect(container.querySelector('[data-detail]')?.textContent).toBe('request-50');
    expect(details).toHaveBeenCalledTimes(1);
    const firstItem = readDeskWaits().items[0];
    act(() => root.render(<Badge />));
    details.mockClear();
    write('waiting', 51, true);
    expect(container.querySelector('[data-count]')?.textContent).toBe('2');
    expect(details).not.toHaveBeenCalled();
    act(() => root.render(<><Badge /><Drawer /></>));
    expect(container.querySelector('[data-detail]')?.textContent).toBe('request-50,request-51');
    expect(readDeskWaits().items[0]).toBe(firstItem);
});

it('reuses the badge summary identity when details change at the same count', () => {
    const summaries: ReturnType<typeof useDeskWaitsSummary>[] = [];
    function Badge() {
        const summary = useDeskWaitsSummary();
        summaries.push(summary);
        return <span>{summary.count}</span>;
    }
    write('waiting', 50, true);
    act(() => root.render(<Badge />));
    const initial = summaries.at(-1);
    const worker = storage.getState().sessions.waiting!;
    act(() => storage.getState().applySessions([{ ...worker, metadataVersion: worker.metadataVersion + 1,
        metadata: { ...worker.metadata!, name: 'Renamed worker' } }]));
    expect(summaries.at(-1)).toBe(initial);
    expect(summaries).toHaveLength(1);
    expect(readDeskWaits().items[0]?.sessionTitle).toBe('Renamed worker');
});

it('R10/R24: lists view-only waits without counting or signalling them, including unloaded waits', () => {
    const values: ReturnType<typeof useDeskWaitsActivity>[] = [];
    const viewer = createSessionFixture({ id: 'viewer', active: true, accessLevel: 'view', canApprovePermissions: false,
        agentState: { requests: { request: { tool: 'Bash', arguments: { command: 'pwd' }, createdAt: 1 } } } });
    act(() => storage.getState().applySessions([
        viewer,
        createSessionFixture({ id: 'viewer-unloaded', active: true, accessLevel: 'view', canApprovePermissions: false,
            pendingPermissionRequestCount: 1 }),
        createSessionFixture({ id: 'owner-unloaded', active: true, pendingPermissionRequestCount: 1 }),
    ]));
    function Badge() {
        const activity = useDeskWaitsActivity();
        values.push(activity);
        return <span>{activity.count}</span>;
    }
    act(() => root.render(<Badge />));
    expect(container.textContent).toBe('1');
    expect(readDeskWaits().items).toMatchObject([{ sessionId: 'viewer', disabledReason: 'readOnly' }]);
    expect(readDeskWaits().unloaded.map(item => item.sessionId).sort()).toEqual(['owner-unloaded', 'viewer-unloaded']);
    expect(values.at(-1)).toMatchObject({ requests: [], unloadedSessionIds: ['owner-unloaded'] });
    expect(Object.values(selectDeskNotificationWaits(storage.getState()).waitSessionIds)).toEqual(['owner-unloaded']);
    act(() => storage.getState().applySessions([{ ...viewer, accessLevel: 'edit', canApprovePermissions: true }]));
    expect(container.textContent).toBe('2');
    expect(values.at(-1)?.requests).toEqual([{ sessionId: 'viewer', requestId: 'request' }]);
    expect(readDeskWaits().items[0]?.disabledReason).toBeNull();
});

it('scopes summaries to one session while sharing classification, readiness and stable summaries', () => {
    const values: ReturnType<typeof useDeskWaitsSummary>[] = [];
    function Badge({ sessionId }: { sessionId: string }) {
        const summary = useDeskWaitsSummary({ onlySessionId: sessionId });
        values.push(summary);
        const global = useDeskWaitsSummary();
        const workers = useDeskWaitsSummary(sessionId);
        return <span>{`${summary.ready}:${summary.count}/${global.count}/${workers.count}`}</span>;
    }
    const details = vi.spyOn(waitingItems, 'toWaitingItems');
    act(() => {
        storage.getState().applySessions([createSessionFixture({ id: 'other-waiting', active: true, agentState: {} })]);
        storage.getState().applyMessagesLoaded('waiting');
        storage.getState().applyMessagesLoaded('other-waiting');
        storage.setState({ isDataReady: false });
    });
    act(() => root.render(<Badge sessionId="waiting" />));
    expect(container.textContent).toBe('false:0/0/0');
    act(() => storage.getState().applyReady());
    write('waiting', 50, true);
    expect(container.textContent).toBe('true:1/1/0');
    const own = values.at(-1);
    write('other-waiting', 51, true);
    expect(container.textContent).toBe('true:1/2/1');
    expect(values.at(-1)).toBe(own);
    // Switching the selected session must invalidate the scoped selector.
    write('other-waiting', 52, true);
    act(() => root.render(<Badge sessionId="other-waiting" />));
    expect(container.textContent).toBe('true:2/3/1');
    expect(details).not.toHaveBeenCalled();
});

it('counts unloaded waits only for the selected session', () => {
    act(() => storage.getState().applySessions(['own-unloaded', 'worker-unloaded'].map(id => createSessionFixture({
        id, active: true, agentState: {}, pendingUserActionRequestCount: 1,
    }))));
    function Badge() {
        const own = useDeskWaitsSummary({ onlySessionId: 'own-unloaded' });
        const worker = useDeskWaitsSummary({ onlySessionId: 'worker-unloaded' });
        const empty = useDeskWaitsSummary({ onlySessionId: 'waiting' });
        return <span>{`${own.count}/${worker.count}/${empty.count}`}</span>;
    }
    act(() => root.render(<Badge />));
    expect(container.textContent).toBe('1/1/0');
});


it('projects creature request identities without drawer work and retains equivalent activity', () => {
    const values: ReturnType<typeof useDeskWaitsActivity>[] = [];
    function Header() {
        const activity = useDeskWaitsActivity();
        values.push(activity);
        return <output>{activity.count}</output>;
    }
    const details = vi.spyOn(waitingItems, 'toWaitingItems');
    const labels = vi.spyOn(sessionUtils, 'getSessionName');
    write('waiting', 50, true);
    act(() => root.render(<Header />));
    expect(values.at(-1)).toMatchObject({ count: 1, requests: [{ sessionId: 'waiting', requestId: 'request-50' }], unloadedSessionIds: [] });
    const initial = values.at(-1);
    for (let i = 0; i < 10; i++) write('streaming', i);
    const worker = storage.getState().sessions.waiting!;
    act(() => storage.getState().applySessions([{ ...worker, metadataVersion: worker.metadataVersion + 1,
        metadata: { ...worker.metadata!, name: 'Renamed worker' } }]));
    expect(values.at(-1)).toBe(initial);
    expect(values).toHaveLength(1);
    write('waiting', 51, true);
    expect(values.at(-1)?.requests.map(request => request.requestId)).toEqual(['request-50', 'request-51']);
    expect(values.at(-1)?.count).toBe(2);
    expect(details).not.toHaveBeenCalled();
    expect(labels).not.toHaveBeenCalled();
});


it('scopes activity identities and count to the coordinator without changing unscoped waits', () => {
    const values: ReturnType<typeof useDeskWaitsActivity>[] = [];
    function Header({ sessionId }: { sessionId: string }) {
        const own = useDeskWaitsActivity({ onlySessionId: sessionId });
        const summary = useDeskWaitsSummary({ onlySessionId: sessionId });
        const all = useDeskWaitsActivity();
        values.push(own);
        return <output>{`${summary.ready}:${own.count}/${all.count}`}</output>;
    }
    act(() => {
        storage.getState().applySessions([createSessionFixture({ id: 'other-waiting', active: true, agentState: {} })]);
        storage.getState().applyMessagesLoaded('waiting');
    });
    act(() => root.render(<Header sessionId="waiting" />));
    expect(container.textContent).toBe('true:0/0');
    const initial = values.at(-1);
    write('other-waiting', 70, true);
    expect(container.textContent).toBe('true:0/1');
    expect(values.at(-1)).toBe(initial);
    write('waiting', 71, true);
    expect(container.textContent).toBe('true:1/2');
    expect(values.at(-1)?.requests).toEqual([{ sessionId: 'waiting', requestId: 'request-71' }]);
    expect(readDeskWaits().items.map(item => item.requestId)).toEqual(['request-70', 'request-71']);
    act(() => storage.getState().applyMessagesLoaded('other-waiting'));
    act(() => root.render(<Header sessionId="other-waiting" />));
    expect(values.at(-1)?.requests).toEqual([{ sessionId: 'other-waiting', requestId: 'request-70' }]);
});

it('keeps coordinator waits unknown until both sync and its questions are loaded, then recovers after eviction', () => {
    function Header({ sessionId = 'waiting' }: { sessionId?: string }) {
        const own = useDeskWaitsActivity({ onlySessionId: sessionId });
        const summary = useDeskWaitsSummary({ onlySessionId: sessionId });
        return <output>{`${summary.ready}:${own.count}`}</output>;
    }
    act(() => root.render(<Header />));
    expect(container.textContent).toBe('false:null');
    act(() => storage.getState().applyMessagesLoaded('waiting'));
    expect(container.textContent).toBe('true:0');
    act(() => storage.setState({ isDataReady: false }));
    expect(container.textContent).toBe('false:null');
    act(() => storage.getState().applyReady());
    expect(container.textContent).toBe('true:0');
    act(() => storage.getState().evictSessionMessages('waiting'));
    expect(container.textContent).toBe('false:null');
    act(() => storage.getState().applyMessagesLoaded('waiting'));
    expect(container.textContent).toBe('true:0');
    act(() => root.render(<Header sessionId="missing" />));
    expect(container.textContent).toBe('false:null');
    const listOnly = createSessionFixture({ id: 'list-only', active: true, agentState: {} });
    act(() => storage.getState().mergeSessionListRenderables([buildSessionListRenderableFromSession(listOnly)]));
    act(() => root.render(<Header sessionId="list-only" />));
    expect(container.textContent).toBe('false:null');
    act(() => storage.getState().applySessions([listOnly]));
    expect(container.textContent).toBe('false:null');
    act(() => storage.getState().applyMessagesLoaded('list-only'));
    expect(container.textContent).toBe('true:0');
});

it('withholds a coordinator count for unloaded or partially loaded questions without changing the global count', () => {
    act(() => storage.getState().applySessions([createSessionFixture({
        id: 'own-unloaded', active: true, agentState: {}, pendingUserActionRequestCount: 1,
    })]));
    function Header() {
        const own = useDeskWaitsActivity({ onlySessionId: 'own-unloaded' });
        return <output>{`${own.count}/${useWaitingCount()}`}</output>;
    }
    act(() => root.render(<Header />));
    expect(container.textContent).toBe('null/1');
    write('own-unloaded', 80, true);
    expect(container.textContent).toBe('null/1');
    act(() => storage.getState().applyMessagesLoaded('own-unloaded'));
    expect(container.textContent).toBe('1/1');
});
