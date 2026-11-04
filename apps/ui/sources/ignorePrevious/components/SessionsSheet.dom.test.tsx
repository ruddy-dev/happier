/** @vitest-environment jsdom */
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Pressable, View } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDeferred } from '@/dev/testkit';
import { createSessionFixture } from '@/dev/testkit/fixtures/sessionFixtures';
import { storage } from '@/sync/domains/state/storage';
import { buildSessionListRenderableFromSession } from '@/sync/domains/session/listing/sessionListRenderable';
import { getActiveServerSnapshot } from '@/sync/domains/server/serverRuntime';
import { buildScopedSessionRouteHref } from '@/hooks/session/sessionRouteServerScope';
import { FocusReturnProvider } from '@/keyboard/focusReturn';
import { installSessionRecordHarness, jsonResponse, plainWorkerRecord } from '../testkit/sessionRecordHarness';
import { deskPrefs } from '../deskPrefs';
import { SessionsSheet } from './SessionsSheet';

vi.mock('react-native', async () => vi.importActual('react-native-web'));
const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock('expo-router', async () => {
    const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
    return createExpoRouterMock({ pathname: '/desk', router: { navigate } }).module;
});
vi.mock('@react-navigation/native', async () => {
    const { createReactNavigationNativeMock } = await import('@/dev/testkit/mocks/reactNavigation');
    return createReactNavigationNativeMock();
});
vi.mock('@/hooks/ui/useReducedMotionPreference', async () => {
    const { createReducedMotionModuleMock } = await import('@/dev/testkit/mocks/reducedMotion');
    return createReducedMotionModuleMock(true);
});
vi.mock('@/voice/context/voiceHooks', () => ({ voiceHooks: { onAgentRequest: vi.fn(), onSessionOnline: vi.fn(), onSessionOffline: vi.fn() } }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Host() {
    const openerRef = React.useRef<View>(null);
    const [open, setOpen] = React.useState(false);
    return <FocusReturnProvider>
        <Pressable ref={openerRef} testID="sessions-opener" accessibilityRole="button" onPress={() => setOpen(true)} />
        {open && <SessionsSheet openerRef={openerRef} onClose={() => setOpen(false)} />}
    </FocusReturnProvider>;
}
let root: Root;
let container: HTMLDivElement;
let previousStorage: ReturnType<typeof storage.getState>;
let previousStyle: ReturnType<typeof deskPrefs.get<'chatStyle'>>;
let previousCoordinator: string | null;
let harness: ReturnType<typeof installSessionRecordHarness>;
let serverId: string;
const node = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
function element(id: string) {
    const result = node(id);
    if (!result) throw new Error(`Missing ${id}`);
    return result;
}
async function click(id: string) {
    await act(async () => { element(id).focus(); element(id).click(); });
}
async function search(value: string) {
    await act(async () => {
        const input = element('ip-sessions-search');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });
}
async function open() {
    await act(async () => root.render(<SafeAreaInsetsContext.Provider value={{ top: 0, right: 0, bottom: 0, left: 0 }}><Host /></SafeAreaInsetsContext.Provider>));
    await click('sessions-opener');
}
async function archivesLoaded() {
    await vi.waitFor(async () => {
        await act(async () => {});
        expect(node('ip-sessions-archive-loading')).toBeNull();
    });
}
function archivePage(handler: (path: string) => Promise<Response>) {
    const original = harness.http.getMockImplementation()!;
    harness.http.mockImplementation(path => new URL(path, 'http://localhost').pathname === '/v2/sessions/archived' ? handler(path) : original(path));
}
function record(id: string, name: string) {
    return { ...plainWorkerRecord(id), active: false, archivedAt: 10,
        metadata: JSON.stringify({ v: 1, name, path: '/fixture/project', tag: 'ATR-18-work' }), agentState: null };
}
beforeEach(async () => {
    previousStorage = storage.getState();
    storage.setState(storage.getInitialState(), true);
    harness = installSessionRecordHarness([]);
    serverId = String(getActiveServerSnapshot().serverId);
    storage.setState({ isDataReady: true, profileScope: { serverId, accountId: 'account-a' } });
    archivePage(async () => jsonResponse({ sessions: [], nextCursor: null, hasNext: false }));
    previousStyle = deskPrefs.get('chatStyle');
    previousCoordinator = deskPrefs.get('coordinatorSessionId');
    deskPrefs.set('coordinatorSessionId', 'coordinator');
    vi.stubEnv('EXPO_PUBLIC_IP_WQ_DIR', '');
    navigate.mockClear();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    await harness.sync.refreshSessions({ awaitSessionListHydration: true });
});
afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    harness.restore();
    storage.setState(previousStorage, true);
    deskPrefs.set('chatStyle', previousStyle);
    deskPrefs.set('coordinatorSessionId', previousCoordinator);
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
});

describe('Sessions sheet, real scoped store and archive paging', () => {
    it.each(['current', 'archived'] as const)('keeps %s unreadable encrypted input incomplete even when no readable row was applied, then recovers on replacement', async kind => {
        const opaque = { ...record('encrypted-row', 'Unused'), encryptionMode: 'e2ee' as const,
            metadata: 'opaque-metadata', agentState: 'opaque-state', archivedAt: kind === 'archived' ? 10 : null };
        const original = harness.http.getMockImplementation()!;
        let recover = false;
        harness.http.mockImplementation(path => {
            const url = new URL(path, 'http://localhost');
            if (url.pathname === (kind === 'archived' ? '/v2/sessions/archived' : '/v2/sessions')) {
                return Promise.resolve(jsonResponse({ sessions: recover ? [{ ...opaque, encryptionMode: 'plain',
                    metadata: JSON.stringify({ path: '/repo', host: 'host', name: 'Recovered' }), metadataVersion: 2, agentState: null,
                }] : [opaque], includedActive: true, hasNext: false, nextCursor: null }));
            }
            return original(path);
        });
        if (kind === 'current') await harness.sync.refreshSessions({ awaitSessionListHydration: true });
        await open();
        await archivesLoaded();
        expect(storage.getState().sessions['encrypted-row']).toBeUndefined();
        await search('unfindable');
        await act(async () => { await new Promise(resolve => setTimeout(resolve, 450)); });
        expect(node('ip-sessions-no-matches')).toBeNull();
        expect(node('ip-sessions-unreadable')).not.toBeNull();
        expect(node('ip-sessions-search-partial')).not.toBeNull();
        recover = true;
        await act(async () => {
            if (kind === 'archived') await harness.sync.fetchArchivedSessions();
            else await harness.sync.refreshSessions({ awaitSessionListHydration: true });
        });
        await vi.waitFor(() => expect(node('ip-sessions-no-matches')).not.toBeNull());
        expect(node('ip-sessions-unreadable')).toBeNull();
    });

    it('proves absence only after current and archive cursors both end', async () => {
        const page = createDeferred<Response>();
        const original = harness.http.getMockImplementation()!;
        harness.http.mockImplementation(async path => {
            const url = new URL(path, 'http://localhost');
            if (url.pathname === '/v2/sessions') return jsonResponse({ sessions: [], nextCursor: url.searchParams.has('cursor') ? null : 'current-next', hasNext: !url.searchParams.has('cursor'), includedActive: true });
            return original(path);
        });
        await harness.sync.refreshSessions({ awaitSessionListHydration: true });
        archivePage(async path => new URL(path, 'http://localhost').searchParams.has('cursor') ? page.promise
            : jsonResponse({ sessions: [], nextCursor: 'archive-next', hasNext: true }));
        await open();
        await archivesLoaded();
        await search('missing');
        expect(node('ip-sessions-no-matches')).toBeNull();
        await vi.waitFor(() => expect(harness.http.mock.calls.some(([path]) => path.includes('cursor=archive-next'))).toBe(true));
        expect(node('ip-sessions-no-matches')).toBeNull();
        await act(async () => page.resolve(jsonResponse({ sessions: [], nextCursor: null, hasNext: false })));
        await vi.waitFor(() => expect(node('ip-sessions-no-matches')).not.toBeNull());
        expect(node('ip-sessions-load-archived')).toBeNull();
        expect(node('ip-sessions-load-current')).toBeNull();
        expect(harness.http.mock.calls.some(([path]) => path.includes('cursor=current-next'))).toBe(true);
    });

    it.each(['clear', 'query', 'close', 'scope'] as const)('stops obsolete automatic progression on %s while a page is pending', async cancellation => {
        const page = createDeferred<Response>();
        archivePage(async path => new URL(path, 'http://localhost').searchParams.has('cursor') ? page.promise
            : jsonResponse({ sessions: [], nextCursor: 'pending-page', hasNext: true }));
        await open();
        await search('obsolete');
        await vi.waitFor(() => expect(harness.http.mock.calls.some(([path]) => path.includes('cursor=pending-page'))).toBe(true));
        if (cancellation === 'close') await click('ip-sessions-close');
        else if (cancellation === 'scope') await act(async () => storage.setState({ profileScope: { serverId: 'different-server', accountId: 'different-account' } }));
        else {
            if (cancellation === 'query') await act(async () => storage.getState().applySessions([
                createSessionFixture({ id: 'new-match', metadata: { name: 'Replacement', path: '/fixture', host: 'fixture' } }),
            ]));
            await search(cancellation === 'clear' ? '' : 'replacement');
        }
        await act(async () => page.resolve(jsonResponse({ sessions: [record('obsolete-match', 'Obsolete')], nextCursor: 'must-not-fetch', hasNext: true })));
        // Cross the input-settle interval as well as the response continuation.
        await act(async () => { await new Promise(resolve => setTimeout(resolve, 450)); });
        expect(harness.http.mock.calls.some(([path]) => path.includes('cursor=must-not-fetch'))).toBe(false);
        expect(node('ip-sessions-no-matches')).toBeNull();
        if (cancellation === 'query') expect(node('ip-sessions-row-new-match')).not.toBeNull();
    });

    it('does not page for every keystroke, and stops at a cyclic archive cursor without claiming absence', async () => {
        archivePage(async () => jsonResponse({ sessions: [], nextCursor: 'repeated', hasNext: true }));
        await open();
        await archivesLoaded();
        await search('m'); await search('mi'); await search('missing');
        expect(harness.http.mock.calls.filter(([path]) => path.includes('cursor=repeated'))).toHaveLength(0);
        await vi.waitFor(() => expect(node('ip-sessions-search-partial')).not.toBeNull());
        await act(async () => { await new Promise(resolve => setTimeout(resolve, 450)); });
        expect(harness.http.mock.calls.filter(([path]) => path.includes('cursor=repeated'))).toHaveLength(1);
        expect(node('ip-sessions-no-matches')).toBeNull();
    });

    it('retries a failed append at its cursor and resumes useful searching', async () => {
        let fail = true;
        archivePage(async path => {
            const cursor = new URL(path, 'http://localhost').searchParams.get('cursor');
            if (!cursor) return jsonResponse({ sessions: [], nextCursor: 'retry-page', hasNext: true });
            if (fail) return jsonResponse({ error: 'unavailable' }, 503);
            return jsonResponse({ sessions: [record('recovered-second', 'Recovered second page')], nextCursor: null, hasNext: false });
        });
        await open(); await search('recovered');
        await vi.waitFor(() => expect(node('ip-sessions-archive-error')).not.toBeNull());
        expect(node('ip-sessions-no-matches')).toBeNull();
        fail = false;
        await click('ip-sessions-retry-archived');
        await vi.waitFor(() => expect(node('ip-sessions-row-recovered-second')).not.toBeNull());
        expect(harness.http.mock.calls.filter(([path]) => path.includes('cursor=retry-page'))).toHaveLength(2);
    });

    it('continues a healthy archive search after a current append fails, and retries that current cursor', async () => {
        let fail = true;
        const original = harness.http.getMockImplementation()!;
        harness.http.mockImplementation(async path => {
            const url = new URL(path, 'http://localhost');
            if (url.pathname !== '/v2/sessions') return original(path);
            if (!url.searchParams.has('cursor')) return jsonResponse({ sessions: [], includedActive: true, nextCursor: 'current-retry', hasNext: true });
            return fail ? jsonResponse({ error: 'unavailable' }, 503) : jsonResponse({ sessions: [], nextCursor: null, hasNext: false });
        });
        await harness.sync.refreshSessions({ awaitSessionListHydration: true });
        archivePage(async path => new URL(path, 'http://localhost').searchParams.has('cursor')
            ? jsonResponse({ sessions: [record('healthy-archive', 'Recovered archive')], nextCursor: null, hasNext: false })
            : jsonResponse({ sessions: [], nextCursor: 'archive-healthy', hasNext: true }));
        await open(); await search('recovered');
        await vi.waitFor(() => expect(node('ip-sessions-row-healthy-archive')).not.toBeNull());
        expect(node('ip-sessions-current-error')).not.toBeNull();
        expect(node('ip-sessions-no-matches')).toBeNull();
        await archivesLoaded();
        fail = false;
        await click('ip-sessions-load-current');
        await archivesLoaded();
        expect(node('ip-sessions-current-error')).toBeNull();
        expect(harness.http.mock.calls.filter(([path]) => path.includes('cursor=current-retry'))).toHaveLength(2);
    });

    it('does not let unreadable placeholder titles stop a useful archive search', async () => {
        storage.getState().applySessions([createSessionFixture({ id: 'opaque-current', metadata: null })]);
        archivePage(async path => new URL(path, 'http://localhost').searchParams.has('cursor')
            ? jsonResponse({ sessions: [record('readable-next', 'Unknown repair')], nextCursor: null, hasNext: false })
            : jsonResponse({ sessions: [{ ...record('opaque-archive', 'Unused'), metadata: 'invalid-json' }], nextCursor: 'readable-page', hasNext: true }));
        await open(); await archivesLoaded(); await search('unknown');
        await vi.waitFor(() => expect(node('ip-sessions-row-readable-next')).not.toBeNull());
        expect(node('ip-sessions-row-opaque-current')).toBeNull();
        expect(node('ip-sessions-row-opaque-archive')).toBeNull();
        expect(node('ip-sessions-unreadable')).not.toBeNull();
        expect(node('ip-sessions-no-matches')).toBeNull();
    });

    it('retries a failed current head through the existing refresh owner', async () => {
        let fail = true;
        const original = harness.http.getMockImplementation()!;
        harness.http.mockImplementation(async path => {
            if (new URL(path, 'http://localhost').pathname === '/v2/sessions') return fail
                ? jsonResponse({ error: 'unavailable' }, 503)
                : jsonResponse({ sessions: [plainWorkerRecord('recovered-current')], includedActive: true, nextCursor: null, hasNext: false });
            return original(path);
        });
        await expect(harness.sync.refreshSessions({ awaitSessionListHydration: true })).rejects.toThrow();
        await open(); await search('missing');
        expect(node('ip-sessions-current-error')).not.toBeNull();
        fail = false;
        await click('ip-sessions-load-current');
        await vi.waitFor(() => expect(storage.getState().sessionListRenderables['recovered-current']).toBeDefined());
        expect(node('ip-sessions-current-error')).toBeNull();
    });

    it('loads archives on cold entry, searches an archive-only match and opens its ordinary scoped route', async () => {
        const page = createDeferred<Response>();
        archivePage(() => page.promise);
        await open();
        await search('older repair');
        // An unloaded archive must never be reported as an empty result.
        expect(node('ip-sessions-archive-loading')).not.toBeNull();
        expect(node('ip-sessions-no-matches')).toBeNull();
        await act(async () => page.resolve(jsonResponse({ sessions: [record('older', 'Older repair')], nextCursor: null, hasNext: false })));
        await archivesLoaded();
        expect(element('ip-sessions-archived').textContent).toContain('Older repair');
        await click('ip-sessions-row-older');
        expect(navigate).toHaveBeenCalledWith(buildScopedSessionRouteHref({ sessionId: 'older', serverId }), expect.anything());
        expect(node('ip-sessions-sheet')).toBeNull();
        expect(document.activeElement).toBe(element('sessions-opener'));
        await click('sessions-opener');
        expect(element('ip-sessions-search')).toBe(document.activeElement);
    });

    it('automatically finds a real second-page archive match and leaves further paging manual after a match', async () => {
        archivePage(async path => {
            const cursor = new URL(path, 'http://localhost').searchParams.get('cursor');
            return jsonResponse(cursor === 'older-page'
                ? { sessions: [record('page-two', 'Needle fix')], nextCursor: 'last-page', hasNext: true }
                : cursor ? { sessions: [record('page-three', 'Needle follow-up')], nextCursor: null, hasNext: false }
                : { sessions: [record('page-one', 'Other fix')], nextCursor: 'older-page', hasNext: true });
        });
        await open();
        await archivesLoaded();
        expect(harness.http.mock.calls.some(([path]) => path.includes('cursor='))).toBe(false);
        await search('needle');
        await vi.waitFor(() => expect(node('ip-sessions-row-page-two')).not.toBeNull());
        expect(node('ip-sessions-row-page-three')).toBeNull();
        expect(node('ip-sessions-no-matches')).toBeNull();
        await click('ip-sessions-load-archived');
        await archivesLoaded();
        expect(node('ip-sessions-row-page-three')).not.toBeNull();
        expect(node('ip-sessions-load-archived')).toBeNull();
        expect(element('ip-sessions-row-page-two').textContent).toContain('Needle fix');
        expect((element('ip-sessions-search') as HTMLInputElement).value).toBe('needle');
        expect(harness.http.mock.calls.some(([path]) => new URL(path, 'http://localhost').searchParams.get('cursor') === 'older-page')).toBe(true);
    });

    it.each(['terminal', 'mask'] as const)('%s retains current grouping/search and Escape returns focus at phone width', async style => {
        deskPrefs.set('chatStyle', style);
        vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(320);
        const sessions = [
            createSessionFixture({ id: 'coordinator', metadata: { name: 'Coordinator fixture', path: '/fixture', host: 'fixture' } }),
            createSessionFixture({ id: 'worker', metadata: { name: 'Current repair', tag: 'ATR-18-work', path: '/fixture', host: 'fixture' } }),
            createSessionFixture({ id: 'unlinked', metadata: { name: 'Standalone fixture', path: '/fixture', host: 'fixture' } }),
        ];
        storage.getState().applySessions(sessions);
        await open();
        const sheet = element('ip-sessions-sheet');
        expect(sheet.textContent).toContain('Coordinator');
        expect(sheet.textContent).toContain('On issues');
        expect(sheet.textContent).toContain('No issue');
        expect(document.activeElement).toBe(element('ip-sessions-search'));
        await search('atr-18');
        expect(node('ip-sessions-row-worker')).not.toBeNull();
        expect(node('ip-sessions-row-unlinked')).toBeNull();
        await search('standalone');
        expect(node('ip-sessions-row-unlinked')).not.toBeNull();
        await act(async () => { element('ip-sessions-search').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
        expect(node('ip-sessions-sheet')).toBeNull();
        expect(document.activeElement).toBe(element('sessions-opener'));
        expect(navigate).not.toHaveBeenCalled();
    });

    it('reports an archive failure with retry instead of a false empty state', async () => {
        let fail = true;
        archivePage(async () => fail ? jsonResponse({ error: 'forbidden' }, 403) : jsonResponse({ sessions: [record('retried', 'Recovered repair')], nextCursor: null, hasNext: false }));
        await open();
        await search('recovered');
        expect(node('ip-sessions-archive-error')).not.toBeNull();
        expect(node('ip-sessions-no-matches')).toBeNull();
        fail = false;
        await click('ip-sessions-retry-archived');
        await archivesLoaded();
        expect(node('ip-sessions-row-retried')).not.toBeNull();
    });

    it('clears search and stale results on account change, and hides data until the active server scope is ready', async () => {
        archivePage(async () => jsonResponse({ sessions: [record('account-a-row', 'Account A repair')], nextCursor: null, hasNext: false }));
        await open();
        await search('account a');
        await archivesLoaded();
        expect(node('ip-sessions-row-account-a-row')).not.toBeNull();
        await act(async () => storage.setState({ profileScope: { serverId: 'other-server', accountId: 'account-b' } }));
        expect(node('ip-sessions-row-account-a-row')).toBeNull();
        expect(node('ip-sessions-scope-pending')).not.toBeNull();
        archivePage(async () => jsonResponse({ sessions: [record('account-b-row', 'Account B repair')], nextCursor: null, hasNext: false }));
        // Sync clears the account-owned sessions before activating the new profile scope.
        await act(async () => storage.setState({ sessions: {}, sessionListRenderables: {}, profileScope: { serverId, accountId: 'account-b' } }));
        expect((element('ip-sessions-search') as HTMLInputElement).value).toBe('');
        await search('account b');
        await archivesLoaded();
        expect(node('ip-sessions-row-account-b-row')).not.toBeNull();
        expect(node('ip-sessions-row-account-a-row')).toBeNull();
    });

    it('shows unavailable metadata honestly, retains a view-only full-record archive and excludes deleted, hidden and other-server rows', async () => {
        const fullOnly = createSessionFixture({ id: 'view-only', active: false, archivedAt: 1, accessLevel: 'view',
            metadata: { name: 'Readable archive', path: '/fixture/project', host: 'fixture' } });
        storage.getState().applySessions([
            fullOnly,
            createSessionFixture({ id: 'deleted', archivedAt: 1 }),
            createSessionFixture({ id: 'foreign', archivedAt: 1, serverId: 'other-server' }),
            createSessionFixture({ id: 'system', archivedAt: 1, metadata: { path: '/fixture', host: 'fixture', systemSessionV1: { v: 1, key: 'fixture-system', hidden: true } } }),
        ]);
        storage.getState().mergeSessionListRenderables([{
            ...buildSessionListRenderableFromSession(createSessionFixture({ id: 'opaque', archivedAt: 1, metadata: null })),
            metadataUnavailable: true,
        }]);
        const { ['view-only']: _evicted, ...remaining } = storage.getState().sessionListRenderables;
        storage.setState({ sessionListRenderables: remaining, deletedSessionIds: { deleted: true } });
        await open();
        await click('ip-sessions-toggle-archived');
        await archivesLoaded();
        expect(element('ip-sessions-row-view-only').textContent).toContain('Readable archive');
        expect(node('ip-sessions-unreadable')).not.toBeNull();
        for (const id of ['opaque', 'deleted', 'foreign', 'system']) expect(node(`ip-sessions-row-${id}`)).toBeNull();
        await search('unfindable');
        await act(async () => { await new Promise(resolve => setTimeout(resolve, 450)); });
        expect(node('ip-sessions-no-matches')).toBeNull();
        expect(node('ip-sessions-search-partial')).not.toBeNull();
        await search('readable');
        // Merely browsing or searching must not archive, unarchive, stop or retire anything.
        expect(harness.http.mock.calls.every(([path]) => !/\/(archive|unarchive|stop)(\?|$)/.test(path))).toBe(true);
        await click('ip-sessions-row-view-only');
        expect(navigate).toHaveBeenCalledWith(buildScopedSessionRouteHref({ sessionId: 'view-only', serverId }), expect.anything());
    });

    it('distinguishes a cold current store from a loaded empty page and does not fetch before scope data is ready', async () => {
        storage.setState({ isDataReady: false });
        await open();
        expect(node('ip-sessions-scope-pending')).not.toBeNull();
        expect(node('ip-sessions-current-empty')).toBeNull();
        expect(harness.http.mock.calls.some(([path]) => path.includes('/archived'))).toBe(false);
        await act(async () => storage.setState({ isDataReady: true }));
        await archivesLoaded();
        expect(node('ip-sessions-current-empty')).not.toBeNull();
        await search('missing');
        await vi.waitFor(() => expect(node('ip-sessions-no-matches')).not.toBeNull());
        expect(node('ip-sessions-search-partial')).toBeNull();
    });

    it('respects a current sidebar projection over a stale archived full record', async () => {
        const session = createSessionFixture({ id: 'returned', archivedAt: 1,
            metadata: { name: 'Returned session', path: '/fixture/project', host: 'fixture' } });
        storage.getState().applySessions([session]);
        storage.getState().mergeSessionListRenderables([buildSessionListRenderableFromSession({ ...session, archivedAt: null })]);
        await open();
        await click('ip-sessions-toggle-archived');
        await archivesLoaded();
        expect(document.querySelectorAll('[data-testid="ip-sessions-row-returned"]')).toHaveLength(1);
        expect(element('ip-sessions-archived').querySelector('[data-testid="ip-sessions-row-returned"]')).toBeNull();
    });
});
