import { expect } from '@playwright/test';

import { createDeskSeeder } from '../../src/testkit/deskTest/deskSeed';
import { deskTest as test, openDesk } from '../../src/testkit/deskTest/deskTest';
import { DESK_COORDINATOR_PATH } from '../../src/testkit/deskTest/deskUiEnv';

/** J1, morning check-in from a cold load: one coordinator and three workers on two issues. */
async function seedMorning(seed: ReturnType<typeof createDeskSeeder>) {
    await seed.startCoordinator(DESK_COORDINATOR_PATH);
    const working = await seed.startWorker({ issueTag: 'ATR-101-build', title: 'Wiring the export' });
    await working.setWorking();
    const idle = await seed.startWorker({ issueTag: 'ATR-101-review', title: 'Reading the diff' });
    await idle.setIdle();
    const waiting = await seed.startWorker({ issueTag: 'ATR-102-build', title: 'Running the migration' });
    await waiting.agent.publishPermissionRequest({ id: 'j1-request', tool: 'Bash', args: { command: 'yarn db:migrate' } });
}

test('the desk says who is waiting, working and idle, from a cold load', async ({ page, desk }) => {
    const seed = createDeskSeeder(desk);
    try {
        await seedMorning(seed);
        // Every value the agent tile ever shows, so a 0 before the list arrives can't slip by between polls.
        await page.addInitScript(() => {
            const seen: string[] = [];
            const approvalCounts: string[] = [];
            (window as unknown as { __deskAgentTile: string[] }).__deskAgentTile = seen;
            (window as unknown as { __deskApprovalCounts: string[] }).__deskApprovalCounts = approvalCounts;
            new MutationObserver(() => {
                const text = document.querySelector('[data-testid="ip-count-all"]')?.textContent;
                if (text && seen[seen.length - 1] !== text) seen.push(text);
                const count = document.querySelector('[data-testid="ip-approvals-open"] [data-testid="ip-approvals-count"]')?.textContent;
                if (count && approvalCounts[approvalCounts.length - 1] !== count) approvalCounts.push(count);
            }).observe(document, { subtree: true, childList: true, characterData: true });
        });
        await openDesk(page, desk);

        const approvals = page.getByTestId('ip-approvals-open');
        const approvalCount = approvals.getByTestId('ip-approvals-count');
        await expect(approvalCount, 'Waiting on you, loaded request count and unit').toHaveText('1 request', { timeout: 10_000 });
        await expect(approvalCount).toBeVisible();
        await expect(approvals).toHaveAccessibleName('Show what waits on you, 1 request');
        const issues = page.getByTestId('ip-work');
        await expect(issues.getByTestId('ip-issue-ATR-101'), 'the ATR-101 card').toBeVisible({ timeout: 10_000 });
        await expect(issues.getByTestId('ip-issue-ATR-102'), 'the ATR-102 card').toBeVisible({ timeout: 10_000 });

        await expect(issues.getByTestId('ip-issue-ATR-101').getByTestId('ip-bulb-dot-working'), "ATR-101's bulb").toBeVisible();
        await expect(issues.getByTestId('ip-issue-ATR-102').getByTestId('ip-bulb-dot-turn'), "ATR-102's bulb").toBeVisible();
        await expect(page.getByTestId('ip-count-working'), 'Working tile').toHaveText('1');
        await expect(page.getByTestId('ip-count-turn'), 'Your-turn tile').toHaveText('1');
        await expect(page.getByTestId('ip-count-idle'), 'Idle tile').toHaveText('1');

        // Must nots: the coordinator is the chat, not a worker; everything has an issue; no false zero.
        await expect(page.getByTestId('ip-count-all'), 'Agents tile, without the coordinator').toHaveText('3');
        await expect(issues.getByText('Coordinator chat')).toHaveCount(0);
        await expect(issues.getByTestId('ip-issue-none'), 'a No issue card').toHaveCount(0);
        await expect(issues.getByText('No issue', { exact: true })).toHaveCount(0);
        const tile = await page.evaluate(() => (window as unknown as { __deskAgentTile: string[] }).__deskAgentTile);
        expect(tile, 'what the Agents tile showed on the way').not.toContain('0');
        const approvalCounts = await page.evaluate(() => (window as unknown as { __deskApprovalCounts: string[] }).__deskApprovalCounts);
        expect(approvalCounts, 'the loaded badge was observed').toContain('1 request');
        // Before sync, a dash is unresolved, never a numeric zero or a count without its unit.
        for (const count of approvalCounts) {
            expect(['– requests', '1 request'], 'what the Waiting badge showed on the way').toContain(count);
        }
    } finally {
        await seed.stopAll();
    }
});

test('issue cards are ordered by urgency (item 2.3)', async ({ page, desk }) => {
    const seed = createDeskSeeder(desk);
    try {
        await seedMorning(seed);
        await openDesk(page, desk);
        const issues = page.getByTestId('ip-work');
        // Match only issue roots, excluding disclosure controls and other card descendants.
        const cards = issues.getByTestId(/^ip-issue-ATR-(?:101|102)$/);
        await expect(cards, 'both seeded issue roots').toHaveCount(2, { timeout: 10_000 });
        await expect(issues.getByTestId('ip-issue-ATR-102'), 'the waiting issue root').toBeVisible({ timeout: 10_000 });
        await expect(issues.getByTestId('ip-issue-ATR-101'), 'the working issue root').toBeVisible({ timeout: 10_000 });
        await expect(cards.nth(0), 'waiting issue first').toHaveAttribute('data-testid', 'ip-issue-ATR-102', { timeout: 10_000 });
        await expect(cards.nth(1), 'working issue second').toHaveAttribute('data-testid', 'ip-issue-ATR-101', { timeout: 10_000 });
    } finally {
        await seed.stopAll();
    }
});
