import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderScreen, standardCleanup } from '@/dev/testkit';
import { createSessionFixture } from '@/dev/testkit/fixtures/sessionFixtures';
import { storage } from '@/sync/domains/state/storage';
import { useSessionProjectScmSnapshot } from '@/sync/store/hooks';
import { SourceControlPullRequestSection } from '@/components/sessions/sourceControl/pullRequests/SourceControlPullRequestSection';
import { WorkerPrBadge } from '../components/WorkerPrBadge';
import { prSnapshot } from '../testkit/prSnapshot';
import { t } from '@/text';
import { Modal } from '@/modal';
import { RPC_METHODS } from '@happier-dev/protocol/rpc';

Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);

const boundary = vi.hoisted(() => ({ rpc: vi.fn() }));
// Only the RPC transport and native modal are replaced. Operations, grant derivation,
// repository publication, selectors, and both rendered consumers execute real code.
vi.mock('@/sync/runtime/orchestration/serverScopedRpc/serverScopedSessionRpc', () => ({
    sessionRpcWithServerScope: (params: unknown) => boundary.rpc(params),
}));
vi.mock('@expo/vector-icons', async () => {
    const { createExpoVectorIconsMock } = await import('@/dev/testkit/mocks/icons');
    return createExpoVectorIconsMock();
});
vi.mock('@react-navigation/native', async () => {
    const { createReactNavigationNativeMock } = await import('@/dev/testkit/mocks/reactNavigation');
    return createReactNavigationNativeMock();
});
vi.mock('expo-router', async () => {
    const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
    return createExpoRouterMock().module;
});
vi.mock('@/sync/runtime/orchestration/serverScopedRpc/serverScopedMachineRpc', () => ({
    machineRpcWithServerScope: (params: unknown) => boundary.rpc(params),
}));
vi.mock('@/modal', async () => {
    const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
    return createModalModuleMock().module;
});

const theme = { colors: {
    border: { default: 'divider', subtle: 'divider' }, surface: { base: 'surface', inset: 'inset' },
    text: { primary: 'text', secondary: 'secondary' }, state: { danger: { foreground: 'danger' } },
} };
const initial = () => prSnapshot({
    pullRequest: null,
    capabilities: {
        readStatus: true, readDiffFile: true, readDiffCommit: true, readLog: true,
        writeInclude: true, writeExclude: true, writeCommit: true,
        writeCommitPathSelection: true, writeCommitLineSelection: true, writeBackout: true,
        writeRemoteFetch: true, writeRemotePull: true, writeRemotePush: true,
        readPullRequests: true, writePullRequestCreate: true, worktreeCreate: false,
    },
});
const result = () => ({ success: true, pullRequests: [prSnapshot().pullRequest] });
function WorkerScm({ sessionId = 'find-worker', writeEnabled = false }: { sessionId?: string; writeEnabled?: boolean }) {
    const snapshot = useSessionProjectScmSnapshot(sessionId);
    return <SourceControlPullRequestSection theme={theme} sessionId={sessionId} snapshot={snapshot} writeEnabled={writeEnabled} />;
}
function seed(id = 'find-worker') {
    storage.getState().applySessions([createSessionFixture({ id, active: true, accessLevel: 'view', metadata: { path: '/repo', host: 'test.invalid' } })]);
    storage.getState().updateSessionProjectScmSnapshot(id, initial());
}
function deferred() {
    let resolve!: (value: ReturnType<typeof result>) => void;
    const promise = new Promise<ReturnType<typeof result>>(r => { resolve = r; });
    return { promise, resolve };
}
let previous: ReturnType<typeof storage.getState>;
beforeEach(() => {
    previous = storage.getState();
    boundary.rpc.mockReset().mockResolvedValue(result());
    vi.mocked(Modal.alert).mockClear();
    storage.setState({ profileScope: { serverId: 'test-server', accountId: 'test-account' } });
    seed();
});
afterEach(() => {
    standardCleanup();
    storage.getState().updateSessionProjectScmSnapshot('find-worker', null);
    storage.getState().updateSessionProjectScmSnapshot('other-worker', null);
    storage.setState(previous, true);
    vi.restoreAllMocks();
});

describe('ATR-99 / J4 explicit Find PR', () => {
    it('keeps the real worker Git Update view reachable with remote writes disabled', async () => {
        // Server feature discovery is a network boundary; no feature probes leave this test.
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 503 }));
        storage.getState().applySettingsLocal({ featureToggles: { 'scm.writeOperations': false }, scmFilesAutoRefreshIntervalMs: 0 });
        boundary.rpc.mockImplementation(async (params) => params.method === RPC_METHODS.SCM_PULL_REQUEST_LIST
            ? result()
            : { success: true, snapshot: initial(), entries: [] });
        const { AppPaneProvider } = await import('@/components/appShell/panes/AppPaneProvider');
        const { SessionRightPanelGitView } = await import('@/components/sessions/panes/git/SessionRightPanelGitView');
        const screen = await renderScreen(<AppPaneProvider><SessionRightPanelGitView sessionId="find-worker" scopeId="find-worker" /></AppPaneProvider>);
        expect(boundary.rpc.mock.calls.filter(([p]) => p.method === RPC_METHODS.SCM_PULL_REQUEST_LIST)).toHaveLength(0);
        expect(screen.findByTestId('session-rightpanel-git-subtab:update')).not.toBeNull();
        await screen.pressByTestIdAsync('session-rightpanel-git-subtab:update');
        expect(screen.findByTestId('scm-pull-request-open-or-reuse')?.props.disabled).toBe(true);
        await screen.pressByTestIdAsync('scm-pull-request-find');
        expect(boundary.rpc.mock.calls.filter(([p]) => p.method === RPC_METHODS.SCM_PULL_REQUEST_LIST)).toHaveLength(1);
        expect(storage.getState().getSessionProjectScmSnapshot('find-worker')?.pullRequest?.number).toBe(42);
    });

    it('does no cold lookup, lists only on click with view grants, and shows the verified PR on Work return', async () => {
        const screen = await renderScreen(<WorkerScm />);
        expect(boundary.rpc).not.toHaveBeenCalled();
        expect(screen.findByTestId('scm-pull-request-open-or-reuse')?.props.disabled).toBe(true);
        expect(screen.findByTestId('scm-pull-request-find')?.props.disabled).toBe(false);
        await screen.pressByTestIdAsync('scm-pull-request-find');
        expect(boundary.rpc.mock.calls.map(([p]) => p.method)).toEqual([RPC_METHODS.SCM_PULL_REQUEST_LIST]);
        expect(boundary.rpc.mock.calls[0][0].payload).toMatchObject({ head: 'feature/pr', state: 'open' });
        expect(storage.getState().getSessionProjectScmSnapshot('find-worker')?.pullRequest).toEqual(prSnapshot().pullRequest);
        await act(async () => screen.tree.unmount());
        const work = await renderScreen(<WorkerPrBadge sessionId="find-worker" />);
        expect(work.findByTestId('ip-worker-pr-find-worker')).not.toBeNull();
        expect(JSON.stringify(work.tree.toJSON())).toContain('#42');
        expect(boundary.rpc).toHaveBeenCalledTimes(1);
    });

    it('shows loading, excludes duplicate clicks, and reports an empty open-PR result without inventing a badge', async () => {
        const pending = deferred();
        boundary.rpc.mockReturnValue(pending.promise);
        const screen = await renderScreen(<WorkerScm />);
        await act(async () => {
            screen.findByTestId('scm-pull-request-find')!.props.onPress();
            screen.findByTestId('scm-pull-request-find')!.props.onPress();
        });
        expect(boundary.rpc).toHaveBeenCalledTimes(1);
        expect(screen.findByTestId('scm-pull-request-find')?.props.disabled).toBe(true);
        expect(JSON.stringify(screen.tree.toJSON())).toContain(t('ignorePrevious.pullRequest.finding'));
        await act(async () => pending.resolve({ success: true, pullRequests: [] }));
        expect(screen.findByTestId('scm-pull-request-find')?.props.disabled).toBe(false);
        expect(JSON.stringify(screen.tree.toJSON())).toContain(t('ignorePrevious.pullRequest.notFound'));
        expect(storage.getState().getSessionProjectScmSnapshot('find-worker')?.pullRequest).toBeNull();
    });

    it('reports lookup failure, keeps unknown unknown, and allows retry', async () => {
        boundary.rpc.mockResolvedValueOnce({ success: false, error: 'Read denied' });
        const screen = await renderScreen(<WorkerScm />);
        await screen.pressByTestIdAsync('scm-pull-request-find');
        expect(boundary.rpc).toHaveBeenCalledTimes(1);
        expect(Modal.alert).toHaveBeenCalled();
        expect(JSON.stringify(screen.tree.toJSON())).not.toContain(t('ignorePrevious.pullRequest.notFound'));
        expect(storage.getState().getSessionProjectScmSnapshot('find-worker')?.pullRequest).toBeNull();
        await screen.pressByTestIdAsync('scm-pull-request-find');
        expect(screen.findByTestId('scm-pull-request-view')).not.toBeNull();
    });

    it.each(['unknown-state', 'wrong-branch', 'wrong-provider', 'wrong-origin'])(
        'does not turn unverifiable data into verified absence: %s', async kind => {
            const pr = prSnapshot().pullRequest!;
            if (kind === 'unknown-state') pr.state = 'unknown';
            if (kind === 'wrong-branch') pr.headBranch = 'another-branch';
            if (kind === 'wrong-provider') pr.provider = { ...pr.provider, nameWithOwner: 'example/another' };
            if (kind === 'wrong-origin') pr.url = 'https://example.invalid/pull/42';
            boundary.rpc.mockResolvedValue({ success: true, pullRequests: [pr] });
            const screen = await renderScreen(<WorkerScm />);
            await screen.pressByTestIdAsync('scm-pull-request-find');
            expect(Modal.alert).toHaveBeenCalled();
            expect(screen.getTextContent()).not.toContain(t('ignorePrevious.pullRequest.notFound'));
            expect(storage.getState().getSessionProjectScmSnapshot('find-worker')?.pullRequest).toBeNull();
        },
    );

    it('drops an old request even when the branch switches away and back', async () => {
        const pending = deferred();
        boundary.rpc.mockReturnValue(pending.promise);
        const screen = await renderScreen(<WorkerScm />);
        await act(async () => { void screen.findByTestId('scm-pull-request-find')!.props.onPress(); });
        await act(async () => storage.getState().updateSessionProjectScmSnapshot('find-worker', { ...initial(), branch: { ...initial().branch, head: 'other-branch' } }));
        await act(async () => storage.getState().updateSessionProjectScmSnapshot('find-worker', initial()));
        await act(async () => pending.resolve(result()));
        expect(storage.getState().getSessionProjectScmSnapshot('find-worker')?.pullRequest).toBeNull();
        expect(screen.findByTestId('scm-pull-request-find')?.props.disabled).toBe(false);
    });

    it('preserves newer file status when publishing the verified PR', async () => {
        const pending = deferred();
        boundary.rpc.mockReturnValue(pending.promise);
        const screen = await renderScreen(<WorkerScm />);
        await act(async () => { void screen.findByTestId('scm-pull-request-find')!.props.onPress(); });
        await act(async () => storage.getState().updateSessionProjectScmSnapshot('find-worker', { ...initial(), fetchedAt: 123, hasConflicts: true }));
        await act(async () => pending.resolve(result()));
        expect(storage.getState().getSessionProjectScmSnapshot('find-worker')).toMatchObject({ fetchedAt: 123, hasConflicts: true, pullRequest: prSnapshot().pullRequest });
    });

    it('keeps create progress visible after an empty Find result', async () => {
        storage.getState().updateSessionProjectScmSnapshot('find-worker', { ...initial(), branch: { ...initial().branch, upstream: 'origin/feature/pr' } });
        let finish!: (value: { success: false; error: string }) => void;
        const pending = new Promise<{ success: false; error: string }>(resolve => { finish = resolve; });
        boundary.rpc.mockResolvedValueOnce({ success: true, pullRequests: [] }).mockReturnValueOnce(pending);
        const screen = await renderScreen(<WorkerScm writeEnabled />);
        await screen.pressByTestIdAsync('scm-pull-request-find');
        expect(screen.getTextContent()).toContain(t('ignorePrevious.pullRequest.notFound'));
        expect(screen.findByTestId('scm-pull-request-open-or-reuse')?.props.disabled).toBe(false);
        await act(async () => { void screen.findByTestId('scm-pull-request-open-or-reuse')!.props.onPress(); });
        expect(screen.getTextContent()).toContain(t('files.sourceControlOperations.update.pullRequests.status.creating'));
        expect(screen.getTextContent()).not.toContain(t('ignorePrevious.pullRequest.notFound'));
        await act(async () => finish({ success: false, error: 'Create denied' }));
    });

    it.each(['missing-session', 'missing-capability', 'denied-capability', 'provider', 'branch', 'detached'])(
        'does not dispatch without a readable scope: %s', async kind => {
            const snapshot = initial();
            if (kind === 'missing-session') storage.setState({ sessions: {} });
            if (kind === 'missing-capability') snapshot.capabilities = undefined;
            if (kind === 'denied-capability') snapshot.capabilities = { ...initial().capabilities!, readPullRequests: false };
            if (kind === 'provider') snapshot.hostingProvider = null;
            if (kind === 'branch') snapshot.branch = { ...snapshot.branch, head: null };
            if (kind === 'detached') snapshot.branch = { ...snapshot.branch, detached: true };
            const screen = await renderScreen(<SourceControlPullRequestSection theme={theme} sessionId="find-worker" snapshot={snapshot} />);
            const button = screen.findByTestId('scm-pull-request-find');
            expect(button === null || button.props.disabled === true).toBe(true);
            if (button) await act(async () => { void button.props.onPress(); });
            expect(boundary.rpc).not.toHaveBeenCalled();
        },
    );

    it.each(['account', 'session', 'repository', 'branch', 'unmount'])(
        'discards a late completion after %s changes', async kind => {
            const pending = deferred();
            boundary.rpc.mockReturnValue(pending.promise);
            const screen = await renderScreen(<WorkerScm />);
            await act(async () => { void screen.findByTestId('scm-pull-request-find')!.props.onPress(); });
            await act(async () => {
                if (kind === 'account') storage.setState({ profileScope: { serverId: 'test-server', accountId: 'other-account' } });
                if (kind === 'session') { seed('other-worker'); screen.tree.update(<WorkerScm sessionId="other-worker" />); }
                if (kind === 'repository') storage.getState().applySessions([createSessionFixture({ id: 'find-worker', active: true, metadata: { path: '/other-repo', host: 'test.invalid' } })]);
                if (kind === 'branch') storage.getState().updateSessionProjectScmSnapshot('find-worker', { ...initial(), branch: { ...initial().branch, head: 'other-branch' } });
                if (kind === 'unmount') screen.tree.unmount();
            });
            await act(async () => pending.resolve(result()));
            expect(storage.getState().getSessionProjectScmSnapshot('find-worker')?.pullRequest ?? null).toBeNull();
            expect(Modal.alert).not.toHaveBeenCalled();
        },
    );
});
