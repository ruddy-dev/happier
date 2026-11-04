import { expect, type Page } from '@playwright/test';

import { openDeskApprovals } from '../../src/testkit/deskTest/openDeskApprovals';
import { createDeskSeeder, type DeskWorker } from '../../src/testkit/deskTest/deskSeed';
import { deskTest as test, openDesk } from '../../src/testkit/deskTest/deskTest';

/** J3 uses disposable local-relay accounts, with no command execution by the synthetic worker. */
test.use({ deskEncryptionMode: 'plain', trace: 'off', screenshot: 'off', video: 'off' });

const failedTitle = 'Answer not sent';
const failedMessage = "Your answer didn't go through. Check the connection and try again.";
const unavailableTitle = 'Request no longer available';
const unavailableMessage = 'This request was already answered or has expired. Open the session to check.';

async function inspect(page: Page, id: string, command: string) {
    const card = page.getByTestId(`ip-waiting-card-${id}`);
    await expect(card).toBeVisible();
    await card.getByTestId(`ip-waiting-toggle-${id}`).click();
    await expect(card.getByTestId(`ip-waiting-detail-${id}`)).toContainText(command);
    const allow = card.getByTestId(`ip-waiting-allow-${id}`);
    await expect(allow).toBeEnabled();
    return { card, allow };
}

async function expectIndependentPending(page: Page, worker: DeskWorker, completed: Record<string, string>) {
    await expect(page.getByTestId('ip-waiting-card-independent')).toBeVisible();
    await expect(page.getByTestId('ip-answered-independent')).toHaveCount(0);
    expect(await worker.readPermissionState()).toEqual({ pending: ['independent'], completed });
}

async function expectNoAnswerAlert(page: Page) {
    for (const text of [failedTitle, failedMessage, unavailableTitle, unavailableMessage]) {
        await expect(page.getByText(text, { exact: true })).toHaveCount(0);
    }
}

type LateResultWindow = Window & { __deskJ3LateResultProcessed?: boolean };

// Install before navigation. Observe native WS messages and completed XHR polling replies.
// Engine.IO handles polling in readystatechange before load. For either transport, this
// plain ACK's Socket.IO/RPC/guard/WaitingCard chain uses synchronous work and microtasks.
// A MessageChannel task follows that work without using the fixture's fake timers.
async function observeErrorProcessing(page: Page, errorCode: string) {
    await page.addInitScript(code => {
        (window as LateResultWindow).__deskJ3LateResultProcessed = false;
        const afterReplyHandlers = () => {
            const barrier = new MessageChannel();
            barrier.port1.onmessage = () => {
                (window as LateResultWindow).__deskJ3LateResultProcessed = true;
                barrier.port1.close();
                barrier.port2.close();
            };
            barrier.port2.postMessage(null);
        };
        window.WebSocket = new Proxy(window.WebSocket, {
            construct(target, args, newTarget) {
                const socket: WebSocket = Reflect.construct(target, args, newTarget);
                const onMessage = (event: MessageEvent) => {
                    if (typeof event.data !== 'string' || !event.data.includes(code)) return;
                    socket.removeEventListener('message', onMessage);
                    afterReplyHandlers();
                };
                socket.addEventListener('message', onMessage, { passive: true });
                return socket;
            },
        });
        window.XMLHttpRequest = new Proxy(window.XMLHttpRequest, {
            construct(target, args, newTarget) {
                const xhr: XMLHttpRequest = Reflect.construct(target, args, newTarget);
                xhr.addEventListener('load', () => {
                    if (xhr.status !== 200 || !xhr.responseURL) return;
                    const url = new URL(xhr.responseURL);
                    if (url.pathname !== '/v1/updates/' || url.searchParams.get('transport') !== 'polling') return;
                    if (xhr.responseType !== '' && xhr.responseType !== 'text') return;
                    if (xhr.responseText.includes(code)) afterReplyHandlers();
                }, { once: true, passive: true });
                return xhr;
            },
        });
    }, errorCode);
}

for (const { theme, width, height, label } of [
    { theme: 'tokyo', width: 390, height: 844, label: 'Terminal Tokyo390' },
    { theme: 'night', width: 1440, height: 900, label: 'SlipNight1440' },
] as const) {
    test.describe(label, () => {
        test.beforeEach(async ({ page }, testInfo) => {
            await page.setViewportSize({ width, height });
            // The scoped runner supplies these; ordinary desk runs use the same seed owner.
            const seeds: Record<string, Record<string, string>> | undefined = testInfo.config.metadata.deskJ3Seeds;
            const { buildStorageSeed }: { buildStorageSeed: (theme: string) => Record<string, string> } =
                await import(new URL('../../../../apps/ui/scripts/ipFixtureShots.mjs', import.meta.url).href);
            const seed = seeds?.[theme] ?? buildStorageSeed(theme);
            await page.addInitScript(values => {
                for (const [key, value] of Object.entries(values)) localStorage.setItem(key, value);
            }, seed);
        });

        async function openWaiting(page: Page, desk: Parameters<typeof openDesk>[1]) {
            await openDesk(page, desk);
            await expect(page.getByTestId('ip-approvals-count')).toHaveText('2 requests', { timeout: 15_000 });
            if (width === 390) await page.getByTestId('ip-tab-waiting').click();
            else await openDeskApprovals(page);
            await expect(page.getByTestId('ip-waiting-card-target')).toBeVisible();
            await expect(page.getByTestId('ip-waiting-card-independent')).toBeVisible();
        }

        test('a request answered elsewhere leaves Waiting and shows Answered without a desk send', async ({ page, desk }) => {
            const seed = createDeskSeeder(desk);
            try {
                const worker = await seed.startWorker({ issueTag: 'ATR-301-build', title: 'External permission completion' });
                await worker.agent.publishPermissionRequest({ id: 'target', tool: 'Bash', args: { command: 'echo external completion' } });
                await worker.agent.publishPermissionRequest({ id: 'independent', tool: 'Bash', args: { command: 'echo independent' } });
                await openWaiting(page, desk);
                expect(worker.agent.getReceivedDecisions()).toEqual([]);

                await worker.agent.completePermissionExternally({ id: 'target', approved: false });
                await expect(page.getByTestId('ip-waiting-card-target')).toHaveCount(0);
                await expect(page.getByTestId('ip-answered-target')).toContainText('Answered elsewhere');
                await expect(page.getByTestId('ip-approvals-count')).toHaveText('1 request');
                await expectIndependentPending(page, worker, { target: 'denied' });
                await expectNoAnswerAlert(page);
                expect(worker.agent.getReceivedDecisions(), 'external completion sends no desk decision').toEqual([]);
                expect(worker.readPermissionRpcEvidence()).toEqual([]);
            } finally { await seed.stopAll(); }
        });

        test('a late error after an in-flight request departs shows no false alert or unrelated change', async ({ page, desk }) => {
            const seed = createDeskSeeder(desk);
            let release!: () => void;
            const responseGate = new Promise<void>(resolve => { release = resolve; });
            const errorCode = 'permission_request_expired';
            await observeErrorProcessing(page, errorCode);
            try {
                const worker = await seed.startWorker({
                    issueTag: 'ATR-302-build', title: 'Late permission result',
                    permissionResponse: async decision => {
                        if (decision.id !== 'target') return;
                        await responseGate;
                        return { ok: false, errorCode, errorMessage: 'Synthetic late permission result' };
                    },
                });
                await worker.agent.publishPermissionRequest({ id: 'target', tool: 'Bash', args: { command: 'echo late result' } });
                await worker.agent.publishPermissionRequest({ id: 'independent', tool: 'Bash', args: { command: 'echo independent' } });
                await openWaiting(page, desk);
                const { card, allow } = await inspect(page, 'target', 'echo late result');
                await allow.click();
                await expect.poll(() => worker.agent.getReceivedDecisions()).toEqual([{ id: 'target', approved: true }]);
                await expect(allow).toHaveAttribute('aria-busy', 'true');
                expect(await worker.readPermissionState()).toEqual({ pending: ['independent', 'target'], completed: {} });

                await worker.agent.completePermissionExternally({ id: 'target', approved: false });
                await expect(card, 'observe departure before releasing the RPC error').toHaveCount(0);
                await expect(page.getByTestId('ip-answered-target')).toContainText('Answered elsewhere');
                await expectIndependentPending(page, worker, { target: 'denied' });
                release();
                await page.waitForFunction(() => (window as LateResultWindow).__deskJ3LateResultProcessed === true);
                await expectNoAnswerAlert(page);
                await expectIndependentPending(page, worker, { target: 'denied' });
                expect(worker.agent.getReceivedDecisions()).toEqual([{ id: 'target', approved: true }]);

                // A new, explicit decision proves the remaining card still works after the error.
                const independent = await inspect(page, 'independent', 'echo independent');
                await independent.allow.click();
                await worker.agent.waitForCompletedPermission('independent');
                await expect(independent.card).toHaveCount(0);
                await expect(page.getByTestId('ip-answered-independent')).toContainText('Allowed');
                expect(worker.agent.getReceivedDecisions()).toEqual([{ id: 'target', approved: true }, { id: 'independent', approved: true }]);
                expect(await worker.readPermissionState()).toEqual({ pending: [], completed: { target: 'denied', independent: 'approved' } });
                await expectNoAnswerAlert(page);
            } finally { release(); await seed.stopAll(); }
        });

        test('a genuine failed Allow shows answer-failed while pending and supports explicit retry', async ({ page, desk }) => {
            const seed = createDeskSeeder(desk);
            let attempts = 0;
            try {
                const worker = await seed.startWorker({
                    issueTag: 'ATR-303-build', title: 'Permission retry',
                    permissionResponse: decision => {
                        if (decision.id === 'target' && ++attempts === 1) {
                            return { ok: false, errorCode: 'permission_response_failed', errorMessage: 'Synthetic permission RPC failure' };
                        }
                    },
                });
                await worker.agent.publishPermissionRequest({ id: 'target', tool: 'Bash', args: { command: 'echo explicit retry' } });
                await worker.agent.publishPermissionRequest({ id: 'independent', tool: 'Bash', args: { command: 'echo independent' } });
                await openWaiting(page, desk);
                const { card, allow } = await inspect(page, 'target', 'echo explicit retry');
                await allow.click();
                await expect(page.getByText(failedTitle, { exact: true })).toBeVisible();
                await expect(page.getByText(failedMessage, { exact: true })).toBeVisible();
                await expect(page.getByText(unavailableTitle, { exact: true })).toHaveCount(0);
                await expect(page.getByText(unavailableMessage, { exact: true })).toHaveCount(0);
                await expect(card).toBeVisible();
                await expect(page.getByTestId('ip-answered-target')).toHaveCount(0);
                expect(await worker.readPermissionState()).toEqual({ pending: ['independent', 'target'], completed: {} });
                expect(worker.agent.getReceivedDecisions()).toEqual([{ id: 'target', approved: true }]);

                await page.getByTestId('web-modal-button-0').and(page.getByRole('button', { name: 'OK', exact: true })).click();
                await expect(allow).toBeEnabled();
                expect(worker.agent.getReceivedDecisions(), 'dismissing the alert sends no automatic retry').toHaveLength(1);
                await allow.click();
                await worker.agent.waitForCompletedPermission('target');
                await expect(card).toHaveCount(0);
                await expect(page.getByTestId('ip-answered-target')).toContainText('Allowed');
                await expect(page.getByTestId('ip-approvals-count')).toHaveText('1 request');
                await expectIndependentPending(page, worker, { target: 'approved' });
                expect(worker.agent.getReceivedDecisions()).toEqual([{ id: 'target', approved: true }, { id: 'target', approved: true }]);
                expect(worker.readPermissionRpcEvidence()).toEqual([
                    { sessionId: worker.sessionId, permissionId: 'target', encrypted: false, matchesDecision: true },
                    { sessionId: worker.sessionId, permissionId: 'target', encrypted: false, matchesDecision: true },
                ]);
                await expectNoAnswerAlert(page);
            } finally { await seed.stopAll(); }
        });
    });
}
