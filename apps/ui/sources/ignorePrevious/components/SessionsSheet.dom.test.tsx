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
import type { SessionListEncryption } from '@/sync/engine/sessions/sessionSnapshot';
import { buildSessionListRenderableFromSession } from '@/sync/domains/session/listing/sessionListRenderable';
import { buildSessionListCacheEntryFromRenderable, buildSessionListRenderableFromCacheEntry } from '@/sync/domains/state/warmCacheAdapters';
import { selectDeskSessions } from '../useDeskSessions';
import { getActiveServerSnapshot } from '@/sync/domains/server/serverRuntime';
import { buildScopedSessionRouteHref } from '@/hooks/session/sessionRouteServerScope';
import { FocusReturnProvider } from '@/keyboard/focusReturn';
import { getPermissionModeLabelForAgentType } from '@/sync/domains/permissions/permissionModeOptions';
import { t } from '@/text';
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

async function staleTitleHead(tailKind: 'current' | 'archived') {
    const cached = createSessionFixture({ id: 'stale-title', serverId, encryptionMode: 'e2ee', metadataVersion: 1,
        metadata: { name: 'Needle cached title', path: '/fixture/project', host: 'fixture', tag: 'ATR-7-work' } });
    storage.getState().applySessions([cached]);
    const latest = { ...plainWorkerRecord(cached.id), encryptionMode: 'e2ee' as const, metadataVersion: 2, agentState: null,
        metadata: JSON.stringify({ name: 'Renamed current title', path: '/fixture/project', host: 'fixture', tag: 'ATR-98-work' }) };
    const metadata = createDeferred<typeof cached.metadata>();
    const entered = createDeferred<void>();
    const detail = createDeferred<Response>();
    const tail = createDeferred<Response>();
    const archiveTail = createDeferred<Response>();
    const owner = harness.sync as unknown as { encryption: SessionListEncryption };
    const decrypt = vi.fn((_version: number, value: string) => {
        entered.resolve();
        return value === latest.metadata ? metadata.promise : Promise.resolve(JSON.parse(value) as typeof cached.metadata);
    });
    vi.spyOn(owner.encryption, 'getSessionEncryption').mockReturnValue({ decryptMetadata: decrypt, decryptAgentState: async () => ({}) });
    vi.spyOn(owner.encryption, 'initializeSessions').mockResolvedValue();
    const original = harness.http.getMockImplementation()!;
    harness.http.mockImplementation(async path => {
        const url = new URL(path, 'http://localhost');
        if (url.pathname === `/v2/sessions/${cached.id}`) return detail.promise;
        if (url.pathname === '/v2/sessions/later-title-match') return jsonResponse({ session: {
            ...record('later-title-match', 'Needle real match'), archivedAt: tailKind === 'archived' ? 10 : null,
        } });
        if (url.pathname === '/v2/sessions') return url.searchParams.has('cursor') ? tail.promise
            : jsonResponse({ sessions: [latest], includedActive: true, hasNext: true, nextCursor: 'title-current-tail' });
        if (url.pathname === '/v2/sessions/archived') return url.searchParams.has('cursor') ? archiveTail.promise
            : jsonResponse({ sessions: [], hasNext: tailKind === 'archived', nextCursor: tailKind === 'archived' ? 'title-archive-tail' : null });
        return original(path);
    });
    await harness.sync.refreshSessions({ awaitSessionListHydration: true });
    await entered.promise;
    // Both the full record and displayed projection are v1, despite the accepted v2 row.
    expect(storage.getState().sessions[cached.id].metadataVersion).toBe(1);
    expect(storage.getState().sessionListRenderables[cached.id].metadataVersion).toBe(1);
    return { cached, latest, metadata, detail, tail, archiveTail, decrypt };
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
    it('uses timely current hydration as a real title match without paging or a redundant exact read', async () => {
        const scenario = await staleTitleHead('current');
        await act(async () => scenario.metadata.resolve(JSON.parse(scenario.latest.metadata)));
        await vi.waitFor(() => expect(storage.getState().sessions[scenario.cached.id]?.metadataVersion).toBe(2));
        await open(); await archivesLoaded();
        await search('renamed');
        await act(async () => { await new Promise(resolve => setTimeout(resolve, 450)); });
        expect(element('ip-sessions-row-stale-title').textContent).toContain('Renamed current title');
        expect(harness.http.mock.calls.some(([path]) => path.includes('cursor='))).toBe(false);
        expect(harness.http.mock.calls.some(([path]) => path === '/v2/sessions/stale-title')).toBe(false);
    });

    it.each([1, 2, 3])('uses exact record version %s against the accepted v2 title while background hydration is deferred', async version => {
        const scenario = await staleTitleHead('current');
        try {
            await open(); await archivesLoaded();
            await vi.waitFor(() => expect(harness.http.mock.calls.some(([path]) => path === '/v2/sessions/stale-title')).toBe(true));
            await act(async () => scenario.detail.resolve(jsonResponse({ session: { ...scenario.latest, metadataVersion: version,
                metadata: JSON.stringify({ name: 'Needle exact record', path: '/fixture/project', host: 'fixture', tag: 'ATR-98-work' }) } })));
            await vi.waitFor(() => expect(storage.getState().sessions[scenario.cached.id]?.metadata?.name).toBe('Needle exact record'));
            await search('needle');
            await act(async () => { await new Promise(resolve => setTimeout(resolve, 450)); });
            expect(harness.sync.isSessionListMetadataVersionStale(scenario.cached.id, version)).toBe(version < 2);
            if (version < 2) {
                expect(node('ip-sessions-row-stale-title')).toBeNull();
                await vi.waitFor(() => expect(harness.http.mock.calls.some(([path]) => path.includes('cursor=title-current-tail'))).toBe(true));
                await act(async () => scenario.tail.resolve(jsonResponse({ sessions: [], includedActive: true, hasNext: false, nextCursor: null })));
                await archivesLoaded();
                expect(node('ip-sessions-search-partial')).not.toBeNull();
                expect(node('ip-sessions-no-matches')).toBeNull();
            } else {
                expect(element('ip-sessions-row-stale-title').textContent).toContain('Needle exact record');
                expect(harness.http.mock.calls.some(([path]) => path.includes('cursor='))).toBe(false);
            }
            await act(async () => { await new Promise(resolve => setTimeout(resolve, 450)); });
            expect(harness.http.mock.calls.filter(([path]) => path === '/v2/sessions/stale-title')).toHaveLength(1);
        } finally {
            await act(async () => {
                scenario.tail.resolve(jsonResponse({ sessions: [], includedActive: true, hasNext: false, nextCursor: null }));
                scenario.metadata.resolve(JSON.parse(scenario.latest.metadata));
            });
        }
        if (version > 2) expect(storage.getState().sessions[scenario.cached.id]?.metadataVersion).toBe(version);
    });

    it.each(['clear', 'query', 'close', 'scope'] as const)('stops stale-title automatic progression on %s while the current page is pending', async cancellation => {
        const scenario = await staleTitleHead('current');
        try {
            await open(); await archivesLoaded();
            await search('needle');
            await vi.waitFor(() => expect(harness.http.mock.calls.some(([path]) => path.includes('cursor=title-current-tail'))).toBe(true));
            if (cancellation === 'close') await click('ip-sessions-close');
            else if (cancellation === 'scope') await act(async () => storage.setState({ profileScope: { serverId: 'different-server', accountId: 'different-account' } }));
            else {
                if (cancellation === 'query') await act(async () => storage.getState().applySessions([
                    createSessionFixture({ id: 'new-title-match', serverId, metadata: { name: 'Replacement', path: '/fixture', host: 'fixture' } }),
                ]));
                await search(cancellation === 'clear' ? '' : 'replacement');
            }
            await act(async () => scenario.tail.resolve(jsonResponse({ sessions: [], includedActive: true, hasNext: true, nextCursor: 'must-not-fetch' })));
            await act(async () => { await new Promise(resolve => setTimeout(resolve, 450)); });
            expect(harness.http.mock.calls.filter(([path]) => path.includes('cursor=title-current-tail'))).toHaveLength(1);
            expect(harness.http.mock.calls.some(([path]) => path.includes('cursor=must-not-fetch'))).toBe(false);
            if (cancellation === 'query') expect(node('ip-sessions-row-new-title-match')).not.toBeNull();
            if (cancellation === 'clear') expect(element('ip-sessions-row-stale-title').textContent).toContain('Needle cached title');
        } finally {
            await act(async () => {
                scenario.tail.resolve(jsonResponse({ sessions: [], includedActive: true, hasNext: false, nextCursor: null }));
                scenario.detail.resolve(jsonResponse(null, 503));
                scenario.metadata.resolve(JSON.parse(scenario.latest.metadata));
            });
        }
    });

    it.each([
        ['current', 'deferred'], ['current', 'failed'], ['archived', 'deferred'], ['archived', 'failed'],
    ] as const)('continues past a readable stale cached title to a later %s match with %s hydration', async (kind, hydration) => {
        const scenario = await staleTitleHead(kind);
        try {
            if (hydration === 'failed') {
                scenario.metadata.reject(new Error('Metadata boundary unavailable'));
                scenario.detail.resolve(jsonResponse(null, 503));
            }
            await open(); await archivesLoaded();
            expect(element('ip-sessions-row-stale-title').textContent).toContain('Needle cached title');
            await search('needle');
            await vi.waitFor(async () => {
                await act(async () => {});
                expect(harness.http.mock.calls.some(([path]) => path.includes('cursor=title-current-tail'))).toBe(true);
            });
            expect(node('ip-sessions-row-stale-title')).toBeNull();
            expect(node('ip-sessions-search-partial')).not.toBeNull();
            if (kind === 'archived') {
                // Finish current coverage first; the unresolved cached row stays partial.
                await act(async () => scenario.tail.resolve(jsonResponse({ sessions: [], includedActive: true, hasNext: false, nextCursor: null })));
                await vi.waitFor(async () => {
                    await act(async () => {});
                    expect(harness.http.mock.calls.some(([path]) => path.includes('cursor=title-archive-tail'))).toBe(true);
                });
                await act(async () => scenario.archiveTail.resolve(jsonResponse({ sessions: [record('later-title-match', 'Needle real match')],
                    hasNext: true, nextCursor: 'after-real-match' })));
            } else {
                await act(async () => scenario.tail.resolve(jsonResponse({ sessions: [{ ...record('later-title-match', 'Needle real match'), archivedAt: null }],
                    includedActive: true, hasNext: true, nextCursor: 'after-real-match' })));
            }
            await vi.waitFor(async () => { await act(async () => {}); expect(node('ip-sessions-row-later-title-match')).not.toBeNull(); });
            await act(async () => { await new Promise(resolve => setTimeout(resolve, 450)); });
            const cursors = harness.http.mock.calls.flatMap(([path]) => {
                const cursor = new URL(path, 'http://localhost').searchParams.get('cursor');
                return cursor ? [cursor] : [];
            });
            expect(cursors).toEqual(kind === 'current' ? ['title-current-tail'] : ['title-current-tail', 'title-archive-tail']);
            expect(harness.http.mock.calls.filter(([path]) => new URL(path, 'http://localhost').pathname === '/v2/sessions/stale-title')).toHaveLength(1);
            expect(node('ip-sessions-no-matches')).toBeNull();
            expect(node('ip-sessions-search-partial')).not.toBeNull();
            await search('');
            expect(element('ip-sessions-row-stale-title').textContent).toContain('Needle cached title');
        } finally {
            await act(async () => {
                scenario.tail.resolve(jsonResponse({ sessions: [], includedActive: true, hasNext: false, nextCursor: null }));
                scenario.archiveTail.resolve(jsonResponse({ sessions: [], hasNext: false, nextCursor: null }));
                scenario.detail.resolve(jsonResponse(null, 503));
                scenario.metadata.resolve(JSON.parse(scenario.latest.metadata));
            });
        }
    });

    it.each([false, true])('suppresses a previously permitted cached match after policy tightens and reaches a later allowed match, mixed head=%s', async mixed => {
        const blocked = { ...record('cached-blocked', 'Needle blocked cached title'), archivedAt: null, updatedAt: 400 };
        const retained = { ...record('cached-allowed', 'Retained allowed neighbor'), archivedAt: null, updatedAt: 100, encryptionMode: 'e2ee' as const };
        const allowed = { ...record('later-allowed', 'Needle allowed later'), archivedAt: null, updatedAt: 50, encryptionMode: 'e2ee' as const };
        const owner = harness.sync as unknown as { encryption: SessionListEncryption };
        vi.spyOn(owner.encryption, 'getSessionEncryption').mockReturnValue({
            decryptMetadata: async (_version, value) => JSON.parse(value), decryptAgentState: async () => ({}),
        });
        const original = harness.http.getMockImplementation()!;
        let tightened = false;
        const tail = createDeferred<Response>();
        harness.http.mockImplementation(async path => {
            const url = new URL(path, 'http://localhost');
            if (url.pathname !== '/v2/sessions') return original(path);
            if (url.searchParams.has('cursor')) return tail.promise;
            return jsonResponse({ sessions: tightened ? [blocked, ...(mixed ? [retained] : [])] : [blocked, retained],
                includedActive: true, hasNext: tightened, nextCursor: tightened ? 'allowed-tail' : null });
        });
        await harness.sync.refreshSessions({ awaitSessionListHydration: true });
        storage.getState().applySessions([blocked, retained].map(row => createSessionFixture({
            id: row.id, serverId, encryptionMode: row.encryptionMode, archivedAt: null,
            updatedAt: row.updatedAt, metadataVersion: row.metadataVersion, metadata: JSON.parse(row.metadata),
        })));
        expect(selectDeskSessions(storage.getState()).list.map(row => row.id)).toContain(blocked.id);
        const retainedProjection = storage.getState().sessionListRenderables[retained.id];
        tightened = true;
        storage.setState({ settings: { ...storage.getState().settings, clientEncryptionRequirementV1: 'require_e2ee' } });
        await harness.sync.refreshSessions({ awaitSessionListHydration: true });
        await open();
        await archivesLoaded();
        expect.soft(node(`ip-sessions-row-${blocked.id}`)).toBeNull();
        expect.soft(container.textContent).not.toContain('Needle blocked cached title');
        expect.soft(selectDeskSessions(storage.getState()).lookup.has(blocked.id)).toBe(false);
        expect(node(`ip-sessions-row-${retained.id}`)).not.toBeNull();
        if (!mixed) expect(storage.getState().sessionListRenderables[retained.id]).toBe(retainedProjection);
        await search('needle');
        try {
            await vi.waitFor(async () => {
                await act(async () => {});
                expect(harness.http.mock.calls.some(([path]) => path.includes('cursor=allowed-tail'))).toBe(true);
            });
        } finally {
            await act(async () => tail.resolve(jsonResponse({ sessions: [allowed], includedActive: true, hasNext: false, nextCursor: null })));
        }
        await vi.waitFor(async () => {
            await act(async () => {});
            expect(node(`ip-sessions-row-${allowed.id}`)).not.toBeNull();
        });
        expect(node(`ip-sessions-row-${blocked.id}`)).toBeNull();
        expect(node('ip-sessions-search-partial')).not.toBeNull();
        expect(harness.sync.getSessionListPagingState('current')).toEqual({ status: 'unavailable', retry: null, hasUnmaterializedRows: true });
        // Relaxation exposes the retained cache again; a new permitted replacement clears coverage.
        await act(async () => storage.setState({ settings: { ...storage.getState().settings, clientEncryptionRequirementV1: 'follow_account' } }));
        if (!mixed) expect(node(`ip-sessions-row-${blocked.id}`)).not.toBeNull();
        tightened = false;
        await act(async () => harness.sync.refreshSessions({ awaitSessionListHydration: true }));
        expect(harness.sync.getSessionListPagingState('current')).toEqual({ status: 'exhausted', retry: null, hasUnmaterializedRows: false });
    });

    it('suppresses unverified warm rows under require_e2ee and restores an allowed cached projection from a fetched row without full hydration', async () => {
        const original = harness.http.getMockImplementation()!;
        const detail = createDeferred<Response>();
        let fetched = false;
        harness.http.mockImplementation(async path => {
            const pathname = new URL(path, 'http://localhost').pathname;
            if (pathname === '/v2/sessions/warm-allowed' || pathname === '/v2/sessions/warm-blocked') return detail.promise;
            if (fetched && pathname === '/v2/sessions') return jsonResponse({
                sessions: [plainWorkerRecord('warm-blocked'), { ...plainWorkerRecord('warm-allowed'), encryptionMode: 'e2ee' }],
                includedActive: true, hasNext: true, nextCursor: 'warm-tail',
            });
            return original(path);
        });
        const rows = ['warm-blocked', 'warm-allowed'].map(id => buildSessionListRenderableFromCacheEntry(
            buildSessionListCacheEntryFromRenderable(buildSessionListRenderableFromSession(createSessionFixture({
                id, encryptionMode: id === 'warm-blocked' ? 'plain' : 'e2ee', archivedAt: null,
                metadata: { name: `Needle ${id}`, path: '/fixture/project', host: 'test-host', flavor: 'claude' },
            }))),
        ));
        // The restore owner uses this same adapter and normal replacement store action.
        storage.getState().replaceSessionListRenderables(rows);
        await open();
        await archivesLoaded();
        expect(node('ip-sessions-row-warm-blocked')).not.toBeNull();
        expect(node('ip-sessions-row-warm-allowed')).not.toBeNull();
        await act(async () => storage.setState({ settings: { ...storage.getState().settings, clientEncryptionRequirementV1: 'require_e2ee' } }));
        expect.soft(node('ip-sessions-row-warm-blocked')).toBeNull();
        expect.soft(node('ip-sessions-row-warm-allowed')).toBeNull();
        fetched = true;
        await act(async () => harness.sync.refreshSessions());
        expect(node('ip-sessions-row-warm-blocked')).toBeNull();
        expect(node('ip-sessions-row-warm-allowed')).not.toBeNull();
        expect(storage.getState().sessions['warm-allowed']).toBeUndefined();
        expect(harness.sync.getSessionListPagingState('current').hasUnmaterializedRows).toBe(true);
        await act(async () => storage.setState({ settings: { ...storage.getState().settings, clientEncryptionRequirementV1: 'follow_account' } }));
        expect(node('ip-sessions-row-warm-blocked')).not.toBeNull();
        await act(async () => detail.resolve(jsonResponse({ error: 'Session not found' }, 404)));
    });

    it('applies the shared policy to accepted archives and their full-record fallback without discarding allowed archive membership', async () => {
        const blocked = record('cached-archive-blocked', 'Needle blocked archive');
        const allowed = { ...record('cached-archive-allowed', 'Needle allowed archive'), encryptionMode: 'e2ee' as const };
        const owner = harness.sync as unknown as { encryption: SessionListEncryption };
        vi.spyOn(owner.encryption, 'getSessionEncryption').mockReturnValue({
            decryptMetadata: async (_version, value) => JSON.parse(value), decryptAgentState: async () => ({}),
        });
        storage.getState().applySessions([blocked, allowed].map(row => createSessionFixture({
            id: row.id, serverId, encryptionMode: row.encryptionMode, archivedAt: 10,
            metadataVersion: row.metadataVersion, metadata: JSON.parse(row.metadata),
        })));
        archivePage(async () => jsonResponse({ sessions: [blocked, allowed], nextCursor: null, hasNext: false }));
        await open();
        await archivesLoaded();
        await click('ip-sessions-toggle-archived');
        expect(node(`ip-sessions-row-${blocked.id}`)).not.toBeNull();
        expect(node(`ip-sessions-row-${allowed.id}`)).not.toBeNull();
        // Accepted membership remains true from the permissive fetch. Policy is a separate requirement.
        expect(harness.sync.isArchivedSessionListRowCurrent(blocked.id, blocked.metadataVersion)).toBe(true);
        await act(async () => storage.setState({ settings: { ...storage.getState().settings, clientEncryptionRequirementV1: 'require_e2ee' } }));
        expect(node(`ip-sessions-row-${blocked.id}`)).toBeNull();
        expect(selectDeskSessions(storage.getState()).lookup.has(blocked.id)).toBe(false);
        expect(node(`ip-sessions-row-${allowed.id}`)).not.toBeNull();
        expect(harness.sync.isArchivedSessionListRowCurrent(allowed.id, allowed.metadataVersion)).toBe(true);
        await act(async () => storage.getState().replaceSessionListRenderables([], { coversWholeList: true }));
        expect(node(`ip-sessions-row-${blocked.id}`)).toBeNull();
        expect(node(`ip-sessions-row-${allowed.id}`)).not.toBeNull();
        await act(async () => storage.setState({ settings: { ...storage.getState().settings, clientEncryptionRequirementV1: 'follow_account' } }));
        expect(node(`ip-sessions-row-${blocked.id}`)).not.toBeNull();
    });

    it.each(['current', 'archived'] as const)('does not claim complete no-match for a policy-filtered terminal %s page, and completes an eligible empty replacement', async kind => {
        storage.setState({ settings: { ...storage.getState().settings, clientEncryptionRequirementV1: 'require_e2ee' } });
        let blocked = true;
        const original = harness.http.getMockImplementation()!;
        harness.http.mockImplementation(async path => {
            const pathname = new URL(path, 'http://localhost').pathname;
            const matchesKind = pathname === (kind === 'current' ? '/v2/sessions' : '/v2/sessions/archived');
            if (!matchesKind) return original(path);
            return jsonResponse({ sessions: blocked ? [{ ...record('policy-blocked', 'Blocked private content'),
                archivedAt: kind === 'archived' ? 10 : null }] : [], includedActive: true, nextCursor: null, hasNext: false });
        });
        if (kind === 'current') await harness.sync.refreshSessions({ awaitSessionListHydration: true });
        await open();
        await archivesLoaded();
        await search('absent');
        await act(async () => { await new Promise(resolve => setTimeout(resolve, 450)); });
        expect(storage.getState().sessions['policy-blocked']).toBeUndefined();
        expect(storage.getState().sessionListRenderables['policy-blocked']).toBeUndefined();
        expect(node('ip-sessions-row-policy-blocked')).toBeNull();
        expect(container.textContent).not.toContain('Blocked private content');
        expect(node('ip-sessions-no-matches')).toBeNull();
        expect(node('ip-sessions-unreadable')).not.toBeNull();
        expect(node('ip-sessions-search-partial')).not.toBeNull();
        blocked = false;
        await click(kind === 'current' ? 'ip-sessions-load-current' : 'ip-sessions-retry-archived');
        await archivesLoaded();
        expect(node('ip-sessions-unreadable')).toBeNull();
        expect(node('ip-sessions-search-partial')).toBeNull();
        expect(node('ip-sessions-no-matches')).not.toBeNull();
        expect(harness.http.mock.calls.map(([path]) => new URL(path, 'http://localhost').pathname)
            .filter(path => path.startsWith('/v2/sessions/') && !['/v2/sessions/active', '/v2/sessions/archived'].includes(path))).toEqual([]);
    });

    it.each(['terminal', 'mask'] as const)('%s renders available state and published mode context for current and archived rows, with honest unknown mode', async style => {
        deskPrefs.set('chatStyle', style);
        vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(390);
        await act(async () => window.dispatchEvent(new Event('resize')));
        const current = createSessionFixture({ id: 'context-current', serverId, archivedAt: null, presence: 'online',
            metadata: { name: 'Current context', path: '/fixture/project', host: 'fixture', flavor: 'claude', permissionMode: 'read-only' },
            permissionMode: 'yolo' });
        const archived = createSessionFixture({ ...current, id: 'context-archive', archivedAt: 10,
            metadata: { ...current.metadata!, name: 'Archived context', permissionMode: 'default' } });
        const unknown = createSessionFixture({ ...current, id: 'context-unknown', metadata: { ...current.metadata!, name: 'Unknown context' } });
        storage.getState().applySessions([current, archived]);
        archivePage(async () => jsonResponse({ sessions: [{ ...record(archived.id, 'Archived context'),
            metadata: JSON.stringify(archived.metadata), metadataVersion: archived.metadataVersion }], nextCursor: null, hasNext: false }));
        storage.getState().mergeSessionListRenderables([buildSessionListRenderableFromSession(unknown)]);
        const original = harness.http.getMockImplementation()!;
        const pending = createDeferred<Response>();
        harness.http.mockImplementation(path => path === '/v2/sessions/context-unknown' ? pending.promise : original(path));
        await open();
        await archivesLoaded();
        await click('ip-sessions-toggle-archived');
        const mode = getPermissionModeLabelForAgentType('claude', 'read-only');
        const defaultMode = getPermissionModeLabelForAgentType('claude', 'default');
        for (const [id, label] of [['context-current', mode], ['context-archive', defaultMode], ['context-unknown', t('ignorePrevious.workerControl.modeUnknown')]]) {
            const row = element(`ip-sessions-row-${id}`);
            expect(row.textContent).toContain(t('ignorePrevious.countIdle'));
            expect(row.textContent).toContain(label);
            expect(row.getAttribute('aria-label')).toContain(label);
            expect(Number.parseInt(row.style.minHeight, 10)).toBeGreaterThanOrEqual(44);
        }
        expect(element('ip-sessions-row-context-unknown').textContent).not.toContain(mode);
        await click('ip-sessions-row-context-current');
        expect(navigate).toHaveBeenCalledWith(buildScopedSessionRouteHref({ sessionId: current.id, serverId }), expect.anything());
        // The record can finish after navigation; its label was unknown while mounted.
        await act(async () => pending.resolve(jsonResponse({ session: { ...plainWorkerRecord(unknown.id),
            metadata: JSON.stringify(unknown.metadata), metadataVersion: unknown.metadataVersion } })));
        await vi.waitFor(() => expect(storage.getState().sessions[unknown.id]?.metadataVersion).toBe(unknown.metadataVersion));
    });

    it.each([false, true])('uses proven whole-list coverage on an empty head, retaining partial pages=%s', async partial => {
        const rows = [record('moved-worker', 'Needle worker'), record('loaded-neighbor', 'Loaded neighbor')]
            .map(row => ({ ...row, archivedAt: null }));
        storage.getState().applySessions(rows.map(row => createSessionFixture({ id: row.id, serverId,
            metadata: JSON.parse(row.metadata), metadataVersion: row.metadataVersion, archivedAt: null })));
        const original = harness.http.getMockImplementation()!;
        let empty = false;
        harness.http.mockImplementation(path => new URL(path, 'http://localhost').pathname === '/v2/sessions'
            ? Promise.resolve(jsonResponse({ sessions: empty ? [] : rows, includedActive: true,
                hasNext: empty && partial, nextCursor: empty && partial ? 'current-tail' : null })) : original(path));
        await harness.sync.refreshSessions({ awaitSessionListHydration: true });
        archivePage(async path => new URL(path, 'http://localhost').searchParams.has('cursor')
            ? jsonResponse({ sessions: [{ ...record('moved-worker', 'Needle worker'), metadataVersion: 2 }], nextCursor: null, hasNext: false })
            : jsonResponse({ sessions: [], nextCursor: 'archive-tail', hasNext: true }));
        await open();
        await archivesLoaded();
        await search('needle');
        await act(async () => { await new Promise(resolve => setTimeout(resolve, 450)); });
        expect(element('ip-sessions-row-moved-worker')).toBeDefined();
        empty = true;
        await act(async () => harness.sync.refreshSessions({ awaitSessionListHydration: true }));
        const archiveAppended = () => harness.http.mock.calls.some(([path]) => path.includes('cursor=archive-tail'));
        if (partial) {
            expect(archiveAppended()).toBe(false);
            expect(storage.getState().sessionListRenderables['moved-worker']).toBeDefined();
            expect(storage.getState().sessionListRenderables['loaded-neighbor']).toBeDefined();
        } else {
            await vi.waitFor(async () => {
                await act(async () => {});
                expect(archiveAppended()).toBe(true);
                expect(element('ip-sessions-archived').contains(element('ip-sessions-row-moved-worker'))).toBe(true);
            });
            expect(storage.getState().sessions['loaded-neighbor']).toBeDefined();
            expect(storage.getState().sessionListRenderables['loaded-neighbor']).toBeUndefined();
            await search('loaded neighbor');
            await act(async () => { await new Promise(resolve => setTimeout(resolve, 450)); });
            expect(node('ip-sessions-row-loaded-neighbor')).toBeNull();
            expect(node('ip-sessions-no-matches')).not.toBeNull();
        }
    });

    it.each([
        ['current', 'missing'], ['current', 'stale'], ['archived', 'missing'], ['archived', 'stale'],
    ] as const)('waits for authoritative issue identity for a readable %s row with a %s full record, then recovers', async (kind, fullRecord) => {
        const id = 'issue-identity';
        const metadata = { name: 'Ordinary worker', host: 'fixture', path: '/fixture/project', tag: 'ATR-98-build' };
        const current = createSessionFixture({ id, serverId, metadata, metadataVersion: 2, archivedAt: kind === 'archived' ? 10 : null });
        if (fullRecord === 'stale') storage.getState().applySessions([
            createSessionFixture({ ...current, metadata: { ...metadata, tag: 'ATR-7-build' }, metadataVersion: 1 }),
        ]);
        storage.getState().replaceSessionListRenderables([buildSessionListRenderableFromSession(current)], { coversWholeList: true });
        const response = createDeferred<Response>();
        const original = harness.http.getMockImplementation()!;
        harness.http.mockImplementation(path => new URL(path, 'http://localhost').pathname === `/v2/sessions/${id}`
            ? response.promise : original(path));
        if (kind === 'archived') archivePage(async () => jsonResponse({ sessions: [{ ...record(id, metadata.name),
            metadata: JSON.stringify(metadata), metadataVersion: 2 }], nextCursor: null, hasNext: false }));
        await open();
        await archivesLoaded();
        if (kind === 'archived') await act(async () => {
            // Membership is established by the real pager. A subsequently evicted or
            // older full record still requires the canonical exact-record demand.
            const { [id]: _loaded, ...sessions } = storage.getState().sessions;
            storage.setState({ sessions: fullRecord === 'missing' ? sessions : { ...sessions, [id]:
                createSessionFixture({ ...current, metadata: { ...metadata, tag: 'ATR-7-build' }, metadataVersion: 1 }) } });
        });
        await search('ATR-98');
        await act(async () => { await new Promise(resolve => setTimeout(resolve, 450)); });
        expect(node('ip-sessions-no-matches')).toBeNull();
        expect(node('ip-sessions-search-partial')).not.toBeNull();
        expect(node(`ip-sessions-row-${id}`)).toBeNull();
        expect(harness.http.mock.calls.filter(([path]) => new URL(path, 'http://localhost').pathname === `/v2/sessions/${id}`)).toHaveLength(1);
        await act(async () => response.resolve(jsonResponse({ session: { ...record(id, metadata.name), archivedAt: current.archivedAt,
            metadata: JSON.stringify(metadata), metadataVersion: 2 } })));
        await vi.waitFor(async () => {
            await act(async () => {});
            expect(element(`ip-sessions-row-${id}`).textContent).toContain('ATR-98');
            expect(node('ip-sessions-search-partial')).toBeNull();
        });
        if (kind === 'archived') expect(element('ip-sessions-archived').contains(element(`ip-sessions-row-${id}`))).toBe(true);
        await search('ATR-7');
        await act(async () => { await new Promise(resolve => setTimeout(resolve, 450)); });
        expect(node('ip-sessions-no-matches')).not.toBeNull();
    });

    it.each(['needle', 'unfindable'])('finishes desk search for %s when head hydration completes after automatic append', async query => {
        const metadata = createDeferred<{ path: string; host: string; name: string }>();
        const entered = createDeferred<void>();
        const owner = harness.sync as unknown as { encryption: SessionListEncryption };
        const decrypt = vi.fn(() => { entered.resolve(); return metadata.promise; });
        vi.spyOn(owner.encryption, 'getSessionEncryption').mockReturnValue({ decryptMetadata: decrypt, decryptAgentState: async () => ({}) });
        const original = harness.http.getMockImplementation()!;
        harness.http.mockImplementation(async path => {
            const url = new URL(path, 'http://localhost');
            if (url.pathname !== '/v2/sessions') return original(path);
            const append = url.searchParams.has('cursor');
            return jsonResponse({ sessions: append ? [] : [{ ...plainWorkerRecord('pending-head'), encryptionMode: 'e2ee',
                metadata: 'opaque', agentState: null }], includedActive: true, hasNext: !append, nextCursor: append ? null : 'tail' });
        });
        await harness.sync.refreshSessions({ awaitSessionListHydration: true });
        await entered.promise;
        await open(); await archivesLoaded(); await search(query);
        await vi.waitFor(async () => {
            await act(async () => {});
            expect(harness.sync.getSessionListPagingState('current').status).toBe('unavailable');
        });
        expect(node('ip-sessions-row-pending-head')).toBeNull();
        expect(node('ip-sessions-no-matches')).toBeNull();
        const requests = harness.http.mock.calls.length;
        await act(async () => metadata.resolve({ path: '/fixture/project', host: 'fixture', name: 'Needle head' }));
        await vi.waitFor(async () => {
            await act(async () => {});
            if (query === 'needle') expect(element('ip-sessions-row-pending-head').textContent).toContain('Needle head');
            else expect(node('ip-sessions-no-matches')).not.toBeNull();
            expect(node('ip-sessions-search-partial')).toBeNull();
        });
        expect(harness.http.mock.calls).toHaveLength(requests);
        expect(decrypt).toHaveBeenCalledTimes(1);
    });

    it('restores no-match evidence when the owned background metadata decrypt finishes', async () => {
        const metadata = createDeferred<{ path: string; host: string; name: string }>();
        const entered = createDeferred<void>();
        const owner = harness.sync as unknown as { encryption: SessionListEncryption };
        const decrypt = vi.fn(() => { entered.resolve(); return metadata.promise; });
        vi.spyOn(owner.encryption, 'getSessionEncryption').mockReturnValue({
            decryptMetadata: decrypt, decryptAgentState: async () => ({}),
        });
        const original = harness.http.getMockImplementation()!;
        harness.http.mockImplementation(path => new URL(path, 'http://localhost').pathname === '/v2/sessions'
            ? Promise.resolve(jsonResponse({ sessions: [{ ...plainWorkerRecord('hydrating'),
                encryptionMode: 'e2ee', metadata: 'opaque', agentState: null,
            }], includedActive: true, hasNext: false, nextCursor: null })) : original(path));
        await harness.sync.refreshSessions({ awaitSessionListHydration: true });
        await entered.promise;
        await open();
        await archivesLoaded();
        await search('unfindable');
        await act(async () => { await new Promise(resolve => setTimeout(resolve, 450)); });
        expect(node('ip-sessions-no-matches')).toBeNull();
        expect(node('ip-sessions-search-partial')).not.toBeNull();
        const requests = harness.http.mock.calls.length;
        await act(async () => metadata.resolve({ path: '/repo', host: 'host', name: 'Hydrated' }));
        await vi.waitFor(async () => {
            await act(async () => {});
            expect(node('ip-sessions-no-matches')).not.toBeNull();
        });
        expect(node('ip-sessions-search-partial')).toBeNull();
        expect(node('ip-sessions-unreadable')).toBeNull();
        expect(harness.http.mock.calls).toHaveLength(requests);
        expect(decrypt).toHaveBeenCalledTimes(1);
    });

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
        await click(kind === 'archived' ? 'ip-sessions-retry-archived' : 'ip-sessions-load-current');
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
        storage.getState().applySessions([createSessionFixture({ id: 'omitted-retry-cache', serverId, archivedAt: 10,
            metadata: { name: 'Recovered stale cache', path: '/fixture/project', host: 'fixture' } })]);
        let fail = true;
        archivePage(async path => {
            const cursor = new URL(path, 'http://localhost').searchParams.get('cursor');
            if (!cursor) return jsonResponse({ sessions: [], nextCursor: 'retry-page', hasNext: true });
            if (fail) return jsonResponse({ error: 'unavailable' }, 503);
            return jsonResponse({ sessions: [record('recovered-second', 'Recovered second page')], nextCursor: null, hasNext: false });
        });
        await open(); await search('recovered');
        await vi.waitFor(() => expect(node('ip-sessions-archive-error')).not.toBeNull());
        expect(node('ip-sessions-row-omitted-retry-cache')).toBeNull();
        expect(node('ip-sessions-no-matches')).toBeNull();
        fail = false;
        await click('ip-sessions-retry-archived');
        await vi.waitFor(() => expect(node('ip-sessions-row-recovered-second')).not.toBeNull());
        expect(node('ip-sessions-row-omitted-retry-cache')).toBeNull();
        expect(storage.getState().sessions['omitted-retry-cache']).toBeDefined();
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
        archivePage(async () => jsonResponse({ sessions: [
            { ...record(fullOnly.id, 'Readable archive'), metadata: JSON.stringify(fullOnly.metadata), archivedAt: 1 },
            { ...record('opaque', 'Unused'), metadata: 'invalid-json', archivedAt: 1 },
        ], nextCursor: null, hasNext: false }));
        await open();
        await click('ip-sessions-toggle-archived');
        await archivesLoaded();
        await act(async () => {
            const { ['view-only']: _row, ...renderables } = storage.getState().sessionListRenderables;
            storage.setState({ sessionListRenderables: renderables });
        });
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

    it.each(['real-archive', 'stale-archive'])('ignores a cached archive absent from partial pages until authoritative match %s arrives', async matchId => {
        const stale = createSessionFixture({ id: 'stale-archive', serverId, archivedAt: 10,
            metadata: { name: 'Needle cached', path: '/fixture/project', host: 'fixture' } });
        storage.getState().applySessions([stale]);
        // A missed remote delete or unarchive leaves only this cached full record.
        storage.setState({ sessionListRenderables: {} });
        const tail = createDeferred<Response>();
        archivePage(async path => new URL(path, 'http://localhost').searchParams.has('cursor') ? tail.promise
            : jsonResponse({ sessions: [record('other-archive', 'Other')], nextCursor: 'real-match', hasNext: true }));
        await open(); await archivesLoaded();
        await search('needle');
        await act(async () => { await new Promise(resolve => setTimeout(resolve, 450)); });
        expect(node('ip-sessions-row-stale-archive')).toBeNull();
        expect(harness.http.mock.calls.some(([path]) => path.includes('cursor=real-match'))).toBe(true);
        // Partial page evidence must not destructively remove cached records.
        expect(storage.getState().sessions[stale.id]).toBeDefined();
        await act(async () => tail.resolve(jsonResponse({ sessions: [record(matchId, 'Needle real')], nextCursor: null, hasNext: false })));
        await vi.waitFor(() => expect(node(`ip-sessions-row-${matchId}`)).not.toBeNull());
        if (matchId !== stale.id) expect(node('ip-sessions-row-stale-archive')).toBeNull();
        expect(storage.getState().sessions[stale.id]).toBeDefined();
    });

    it('proves no match on terminal empty archive pages without displaying or deleting omitted readable and opaque cache rows', async () => {
        storage.getState().applySessions([
            createSessionFixture({ id: 'omitted-readable', serverId, archivedAt: 10,
                metadata: { name: 'Needle cached', path: '/fixture/project', host: 'fixture' } }),
            createSessionFixture({ id: 'omitted-opaque', serverId, archivedAt: 10, metadata: null }),
        ]);
        await open(); await archivesLoaded();
        await click('ip-sessions-toggle-archived');
        expect(node('ip-sessions-row-omitted-readable')).toBeNull();
        expect(node('ip-sessions-row-omitted-opaque')).toBeNull();
        await search('needle');
        await vi.waitFor(() => expect(node('ip-sessions-no-matches')).not.toBeNull());
        expect(node('ip-sessions-search-partial')).toBeNull();
        expect(storage.getState().sessions['omitted-readable']).toBeDefined();
        expect(storage.getState().sessions['omitted-opaque']).toBeDefined();
    });

    it('rechecks archive membership on reopen before cached matches can stop the new search', async () => {
        const head = createDeferred<Response>();
        let reopening = false;
        archivePage(async path => {
            if (!reopening) return jsonResponse({ sessions: [record('previous-member', 'Needle previous')], nextCursor: null, hasNext: false });
            return new URL(path, 'http://localhost').searchParams.has('cursor')
                ? jsonResponse({ sessions: [record('new-member', 'Needle new')], nextCursor: null, hasNext: false }) : head.promise;
        });
        await open(); await archivesLoaded(); await search('needle');
        expect(node('ip-sessions-row-previous-member')).not.toBeNull();
        await click('ip-sessions-close');
        reopening = true;
        await click('sessions-opener');
        await search('needle');
        expect(node('ip-sessions-row-previous-member')).toBeNull();
        expect(node('ip-sessions-no-matches')).toBeNull();
        await act(async () => head.resolve(jsonResponse({ sessions: [], nextCursor: 'reopened-tail', hasNext: true })));
        await vi.waitFor(() => expect(node('ip-sessions-row-new-member')).not.toBeNull());
        expect(node('ip-sessions-row-previous-member')).toBeNull();
        expect(storage.getState().sessions['previous-member']).toBeDefined();
        expect(harness.http.mock.calls.filter(([path]) => path.includes('cursor=reopened-tail'))).toHaveLength(1);
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
