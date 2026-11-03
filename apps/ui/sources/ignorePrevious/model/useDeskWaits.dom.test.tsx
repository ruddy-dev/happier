/** @vitest-environment jsdom */
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createSessionFixture } from '@/dev/testkit/fixtures/sessionFixtures';
import { storage } from '@/sync/domains/state/storage';
import type { NormalizedMessage } from '@/sync/typesRaw';
import * as waitingItems from './waitingItems';
import * as sessionUtils from '@/utils/sessions/sessionUtils';
import * as transcriptReader from '@/sync/domains/messages/readStoredSessionMessages';
import { readDeskWaits, useDeskWaits, useDeskWaitsSummary, useDeskWaitsActivity, useWaitingCount } from './useDeskWaits';

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
