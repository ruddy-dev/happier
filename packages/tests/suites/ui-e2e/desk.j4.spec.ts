import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { expect } from '@playwright/test';
import { RPC_METHODS } from '@happier-dev/protocol/rpc';
import type { ScmPullRequestListResponse, ScmStatusSnapshotResponse } from '@happier-dev/protocol';
import { createJ4FileResponder, registerJ4Machine } from '../../src/testkit/deskTest/j4Machine';
import { createDeskSeeder } from '../../src/testkit/deskTest/deskSeed';
import { deskTest as test, openDesk } from '../../src/testkit/deskTest/deskTest';
import { DESK_COORDINATOR_PATH } from '../../src/testkit/deskTest/deskUiEnv';
import { createMachineBoundSessionScopedSocketCollector } from '../../src/testkit/sessionSocketBinding';
import { waitFor } from '../../src/testkit/timing';

const reviewUrl = 'https://example.invalid/example/project/pull/42';
const provider = { kind: 'github', name: 'GitHub', baseUrl: 'https://example.invalid', nameWithOwner: 'example/project', remoteName: 'origin' } as const;
const pullRequest = { provider, number: 42, title: 'Synthetic review', url: reviewUrl, baseBranch: 'main', headBranch: 'work', state: 'open' } as const;

// Model only the two read-only synthetic files; no host filesystem is exposed.
async function registerFiles(desk: { serverBaseUrl: string; token: string }, sessionId: string, machineId: string) {
    const files = new Map<string, Buffer>([
        [`${DESK_COORDINATOR_PATH}/work/projects.json`, Buffer.from(JSON.stringify({ ATR: { name: 'Example project' } }))],
        [`${DESK_COORDINATOR_PATH}/work/items/ATR-301.md`, Buffer.from('---\nid: ATR-301\ntitle: Synthetic review\nstatus: review\n---\n')],
    ]);
    const responder = createJ4FileResponder(files);
    const requests: { method: string; owner: 'machine' | 'session' }[] = [];
    const machine = await registerJ4Machine({ baseUrl: desk.serverBaseUrl, token: desk.token, sessionId, machineId,
        handle: (method, params, owner) => { requests.push({ method, owner }); return responder.handle(method, params); },
    });
    return { requests, close: () => { machine.close(); responder.close(); } };
}

// Model the normal cold Git status owner: it reads its PR cache, which is populated by list.
async function registerScm(desk: { serverBaseUrl: string; token: string }, sessionId: string) {
    const { socket } = await createMachineBoundSessionScopedSocketCollector({ baseUrl: desk.serverBaseUrl, token: desk.token, sessionId });
    socket.connect();
    try { await waitFor(() => socket.isConnected(), { timeoutMs: 20_000 }); }
    catch (error) { socket.close(); throw error; }
    let listed = false;
    const listRequests: unknown[] = [];
    let statusCalls = 0;
    let respond: ((response: ScmPullRequestListResponse) => void) | undefined;
    socket.onRpcRequest(({ method, params }) => {
        if (method.endsWith(`:${RPC_METHODS.SCM_PULL_REQUEST_LIST}`)) {
            listRequests.push(params);
            // Hold the genuine RPC response until the journey has observed loading.
            return new Promise<ScmPullRequestListResponse>(resolve => {
                if (respond) throw new Error('Unexpected overlapping Find PR requests');
                respond = response => {
                    listed = response.success && response.pullRequests.length > 0;
                    respond = undefined;
                    resolve(response);
                };
            });
        }
        if (method.endsWith(`:${RPC_METHODS.SCM_STATUS_SNAPSHOT}`)) {
            statusCalls++;
            return { success: true, snapshot: {
                projectKey: 'synthetic:/repo', fetchedAt: Date.now(),
                repo: { isRepo: true, rootPath: '/repo', backendId: 'git', mode: '.git', worktrees: [], remotes: [] },
                capabilities: {
                    readStatus: true, readDiffFile: true, readDiffCommit: true, readLog: true,
                    writeInclude: false, writeExclude: false, writeCommit: false, writeCommitPathSelection: false,
                    writeCommitLineSelection: false, writeBackout: false, writeRemoteFetch: false,
                    writeRemotePull: false, writeRemotePush: false, worktreeCreate: false,
                    writePullRequestCreate: false,
                    readHostingProvider: true, readPullRequests: true, changeSetModel: 'index', supportedDiffAreas: ['included', 'pending', 'both'],
                }, branch: { head: 'work', upstream: 'origin/main', ahead: 0, behind: 0, detached: false },
                hostingProvider: provider, pullRequest: listed ? pullRequest : null, hasConflicts: false, entries: [],
                totals: { includedFiles: 0, pendingFiles: 0, untrackedFiles: 0, includedAdded: 0, includedRemoved: 0, pendingAdded: 0, pendingRemoved: 0 },
            } } satisfies ScmStatusSnapshotResponse;
        }
        return { success: false, error: 'method-not-found' };
    });
    try {
        await socket.rpcRegister(`${sessionId}:${RPC_METHODS.SCM_STATUS_SNAPSHOT}`);
        await socket.rpcRegister(`${sessionId}:${RPC_METHODS.SCM_PULL_REQUEST_LIST}`);
    } catch (error) { socket.close(); throw error; }
    return {
        close: () => { respond?.({ success: false, error: 'Synthetic fixture closed' }); socket.close(); },
        statusCalls: () => statusCalls,
        listRequests,
        reply: (response: ScmPullRequestListResponse) => {
            if (!respond) throw new Error('No pending Find PR request');
            respond(response);
        },
    };
}

for (const width of [390, 1440]) for (const style of ['mask', 'terminal'] as const) {
    test(`M4 Work to PR, ${style} ${width}`, async ({ page, context, desk }) => {
        await page.setViewportSize({ width, height: 900 });
        const opened: string[] = [];
        // Context routes cover the initial request of popups as well as this page.
        await context.route(reviewUrl, async (route) => {
            opened.push(route.request().url());
            await route.fulfill({ status: 200, contentType: 'text/plain', body: 'Synthetic review' });
        });
        const seed = createDeskSeeder(desk);
        let files: Awaited<ReturnType<typeof registerFiles>> | undefined;
        let scm: Awaited<ReturnType<typeof registerScm>> | undefined;
        const machineId = randomUUID();
        const checkpoint = (phase: string) => {
            const count = (method: string, owner: string) => files?.requests.filter(request => request.method === method && request.owner === owner).length ?? 0;
            // Product-originated RPC counts only; no standalone probes or private payloads.
            console.log('workpr checkpoint', JSON.stringify({ phase,
                machineStat: count(RPC_METHODS.STAT_FILE, 'machine'), machineInit: count(RPC_METHODS.DAEMON_BULK_TRANSFER_DOWNLOAD_INIT, 'machine'), sessionInit: count(RPC_METHODS.DAEMON_BULK_TRANSFER_DOWNLOAD_INIT, 'session'),
                status: scm?.statusCalls() ?? 0, list: scm?.listRequests.length ?? 0,
            }));
        };
        try {
            const coordinator = await seed.startCoordinator(DESK_COORDINATOR_PATH, machineId);
            const worker = await seed.startWorker({ issueTag: 'ATR-301-build', title: 'Synthetic worker' });
            files = await registerFiles(desk, coordinator, machineId);
            scm = await registerScm(desk, worker.sessionId);
            await openDesk(page, desk);
            await page.getByTestId('ip-settings-open').and(page.getByRole('button', { name: 'Settings', exact: true })).click();
            const styleRadio = page.getByRole('radio', { name: style === 'mask' ? 'The mask slips' : 'Terminal', exact: true });
            await styleRadio.click();
            await expect(styleRadio).toBeChecked();
            await page.getByTestId('ip-settings-back').and(page.getByRole('button', { name: 'Back to desk', exact: true })).click();
            if (width === 390) await page.getByRole('tab', { name: 'Work' }).click();
            // Expo can retain an inactive desk after Back; roles exclude hidden routes.
            const disclosure = page.getByRole('button', { name: /ATR-301/ });
            const card = page.getByTestId('ip-issue-ATR-301').filter({ has: disclosure });
            await expect(card).toBeVisible({ timeout: 30_000 });
            await expect(card).toHaveCount(1);
            await test.step('Required normal file projection, grouping and actual Work stage', async () => {
                try {
                    // Soft assertions preserve subsequent product diagnostics, but fail the case.
                    await expect.configure({ soft: true }).poll(() => files!.requests.map(request => request.method), { message: 'normal Work requested the synthetic file transfer', timeout: 30_000 }).toContain(RPC_METHODS.DAEMON_BULK_TRANSFER_DOWNLOAD_INIT);
                    await expect.soft(disclosure).toHaveAccessibleName(/Example project/);
                    await expect.soft(disclosure).toHaveAccessibleName(/Synthetic review/);
                    await expect.soft(card.getByTestId('ip-work-stage-ATR-301')).toHaveAccessibleName('Stage: PR', { timeout: 30_000 });
                } finally { checkpoint('projection'); }
            });
            await disclosure.click();
            const badge = card.getByTestId(`ip-worker-pr-${worker.sessionId}`);
            // No snapshot is unknown, not a claim that the provider has no PR.
            await expect(badge, 'cold unopened worker has no verified PR').toHaveCount(0);
            expect(scm.listRequests).toHaveLength(0);
            expect(scm.statusCalls()).toBe(0);
            await disclosure.focus();
            if (process.env.WORKPR_SHOTS) await page.screenshot({ path: join(process.env.WORKPR_SHOTS, `${style}-${width}-cold.png`), mask: [page.locator('input, textarea')] });
            const workUrl = page.url();
            const openWorker = card.getByTestId(`ip-open-worker-${worker.sessionId}`).and(page.getByRole('button', { name: /^Open session Synthetic worker\./ }));
            await openWorker.click();
            await expect(page).toHaveURL(new RegExp(`/session/${worker.sessionId}(?:[/?#]|$)`));
            const workerControl = width === 390
                ? page.getByTestId('session-cockpit-tab-git').and(page.getByRole('tab', { name: 'Git', exact: true }))
                : page.getByTestId('session-action-rail:git').and(page.getByRole('button', { name: /^Git\b/ }));
            await expect(workerControl).toBeVisible();
            const workerUrl = page.url();
            await workerControl.click();
            if (width === 390) {
                // The mobile cockpit switches surfaces inside the session route.
                await expect(page).toHaveURL(workerUrl);
                await expect(workerControl).toHaveAttribute('aria-selected', 'true');
                await expect(page.getByTestId('session-git-screen')).toBeVisible();
            } else {
                // The desktop rail opens the Git pane and pushes its URL state.
                await expect(page).toHaveURL(url => url.pathname === `/session/${worker.sessionId}` && url.searchParams.get('right') === 'git');
                await expect(workerControl).toHaveAttribute('aria-selected', 'true');
                // Keep the passive rail tooltip over Update to catch pointer interception.
                await expect(page.getByRole('tooltip')).toBeVisible();
            }
            const updateTab = page.getByTestId('session-rightpanel-git-subtab:update').and(page.getByRole('tab', { name: 'Update', exact: true }));
            await updateTab.click();
            await expect(updateTab).toHaveAttribute('aria-selected', 'true');
            const section = page.getByTestId('scm-update-pull-request-section');
            const find = section.getByRole('button', { name: 'Find PR', exact: true });
            const operationStatus = section.getByTestId('scm-pull-request-operation-status');
            await expect(find).toBeEnabled();
            await expect(section.getByRole('button', { name: 'Open or reuse PR', exact: true })).toBeDisabled();
            expect(scm.statusCalls()).toBeGreaterThan(0);
            expect(scm.listRequests, 'opening worker / Git / Update must not look up the provider').toHaveLength(0);
            checkpoint('before-explicit-find');

            await test.step('Explicit Find PR loading, empty result and retry after failure', async () => {
                await find.click();
                await expect.poll(() => scm!.listRequests.length).toBe(1);
                await expect(operationStatus).toHaveText('Finding PR…');
                await expect(find).toBeDisabled();
                expect(scm!.listRequests[0]).toMatchObject({ head: 'work', state: 'open' });
                scm!.reply({ success: true, pullRequests: [] });
                await expect(operationStatus).toHaveText('No open PR found for this branch.');
                await expect(find).toBeEnabled();
                expect(opened).toEqual([]);

                await find.click();
                await expect.poll(() => scm!.listRequests.length).toBe(2);
                await expect(operationStatus).toHaveText('Finding PR…');
                scm!.reply({ success: false, error: 'Synthetic provider unavailable' });
                await expect(page.getByText('Synthetic provider unavailable', { exact: true })).toBeVisible();
                await page.getByTestId('web-modal-button-0').and(page.getByRole('button', { name: 'OK', exact: true })).click();
                await expect(find).toBeEnabled();
                await expect(operationStatus).toHaveCount(0);
                expect(opened).toEqual([]);
            });
            await find.click();
            await expect.poll(() => scm!.listRequests.length).toBe(3);
            await expect(operationStatus).toHaveText('Finding PR…');
            scm.reply({ success: true, pullRequests: [pullRequest] });
            await expect(section.getByRole('button', { name: 'View PR', exact: true })).toBeVisible();
            expect(opened).toEqual([]);
            checkpoint('verified-find');
            if (width === 390) {
                const chatTab = page.getByTestId('session-cockpit-tab-chat').and(page.getByRole('tab'));
                await chatTab.click();
                await expect(chatTab).toHaveAttribute('aria-selected', 'true');
                await expect(workerControl).toHaveAttribute('aria-selected', 'false');
            } else {
                // Undo the desktop Git pane URL entry before leaving the worker.
                await page.goBack();
            }
            await expect(page).toHaveURL(workerUrl);
            await expect(workerControl).toBeVisible();
            // The next ordinary Back leaves the opened worker for the original desk.
            await page.goBack();
            await expect(page).toHaveURL(workUrl);
            if (width === 390) await page.getByRole('tab', { name: 'Work' }).click();
            if (await disclosure.getAttribute('aria-expanded') === 'false') await disclosure.click();
            await test.step('Returned Work PR badge and activation', async () => {
                try {
                    await expect(badge, 'explicit Find PR must publish the verified PR to normal Work').toBeVisible({ timeout: 15_000 });
                    await expect(badge).toHaveRole('link');
                    await expect(badge).toHaveAccessibleName('PR #42 open');
                    await expect.soft(card.getByTestId('ip-work-stage-ATR-301')).toHaveAccessibleName('Stage: PR');
                    expect(scm!.listRequests).toHaveLength(3);
                    await badge.focus();
                    if (process.env.WORKPR_SHOTS) await page.screenshot({ path: join(process.env.WORKPR_SHOTS, `${style}-${width}-badge.png`), mask: [page.locator('input, textarea')] });
                    await badge.press('Enter');
                    await expect.poll(() => opened).toEqual([reviewUrl]);
                } finally { checkpoint('returned-work'); }
            });
        } finally {
            checkpoint('final');
            scm?.close();
            files?.close();
            await seed.stopAll();
        }
    });
}
