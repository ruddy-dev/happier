import { expect } from '@playwright/test';

import { observeDeskCounts } from '../../src/testkit/deskTest/deskCountObservation';
import { assertDeskStorageMode } from '../../src/testkit/deskTest/deskStorageProof';
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

test.use({ trace: 'off', screenshot: 'off', video: 'off' });

for (const mode of ['plain', 'e2ee'] as const) {
    test.describe(`J1 ${mode}`, () => {
        test.use({ deskEncryptionMode: mode });
        test('the desk says who is waiting, working and idle, from a cold load', async ({ page, desk }) => {
            const seed = createDeskSeeder(desk);
            try {
                await seedMorning(seed);
                // Every value the agent tile ever shows, so a 0 before the list arrives can't slip by between polls.
                const readCounts = await observeDeskCounts(page);
                await assertDeskStorageMode(desk, mode);
                if (mode === 'e2ee') await seed.assertPersistedEncryption();
                if (mode === 'plain') {
                    await expect(assertDeskStorageMode(desk, 'e2ee'), 'encrypted proof refuses the unchanged plain journey')
                        .rejects.toThrow('storage mode mismatch');
                }
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
                const { agents: tile, approvals: approvalCounts } = await readCounts();
                expect(tile, 'the loaded Agents tile was observed').toContain('3');
                expect(tile, 'what the Agents tile showed on the way').not.toContain('0');
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
                await assertDeskStorageMode(desk, mode);
                if (mode === 'e2ee') await seed.assertPersistedEncryption();
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

    });
}
