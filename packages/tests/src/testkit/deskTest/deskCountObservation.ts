import type { Page } from '@playwright/test';

type DeskCounts = { agents: string[]; approvals: string[] };
type ObservationWindow = Window & {
    __recordDeskCount: (kind: keyof DeskCounts, value: string) => Promise<void>;
    __flushDeskCounts?: () => Promise<void>;
};

/** Retain only count labels in the runner, across every document in this journey. */
export async function observeDeskCounts(page: Page): Promise<() => Promise<DeskCounts>> {
    const counts: DeskCounts = { agents: [], approvals: [] };
    await page.exposeFunction('__recordDeskCount', (kind: unknown, value: unknown) => {
        if (kind !== 'agents' && kind !== 'approvals') throw new Error('Invalid desk observation kind');
        // Do not allow arbitrary DOM contents into failure artifacts.
        const safe = typeof value === 'string' && /^(?:\d+|–)(?: requests?)?$/.test(value) ? value : 'unexpected-count';
        const seen = counts[kind];
        if (seen[seen.length - 1] !== safe) seen.push(safe);
    });
    await page.addInitScript(() => {
        // Playwright installs this binding at the browser boundary before init scripts run.
        const target = window as unknown as ObservationWindow;
        const pending: Promise<void>[] = [];
        let previousAgents: string | null | undefined;
        let previousApprovals: string | null | undefined;
        const capture = () => {
            const agents = document.querySelector('[data-testid="ip-count-all"]')?.textContent;
            const approvals = document.querySelector('[data-testid="ip-approvals-open"] [data-testid="ip-approvals-count"]')?.textContent;
            if (agents && agents !== previousAgents) pending.push(target.__recordDeskCount('agents', agents));
            if (approvals && approvals !== previousApprovals) pending.push(target.__recordDeskCount('approvals', approvals));
            previousAgents = agents;
            previousApprovals = approvals;
        };
        new MutationObserver(capture).observe(document, { subtree: true, childList: true, characterData: true });
        capture();
        target.__flushDeskCounts = async () => {
            capture();
            await Promise.all(pending);
        };
    });
    return async () => {
        await flushDeskCountObservation(page);
        return { agents: [...counts.agents], approvals: [...counts.approvals] };
    };
}

/** Drain observations before a deliberate navigation or a final assertion; never reset them. */
export async function flushDeskCountObservation(page: Page): Promise<void> {
    await page.evaluate(async () => { await (window as unknown as ObservationWindow).__flushDeskCounts?.(); });
}
