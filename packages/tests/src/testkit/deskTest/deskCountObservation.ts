import type { Page } from '@playwright/test';

type DeskCounts = { agents: string[]; approvals: string[] };
type ObservationWindow = Window & {
    __recordDeskCount: (kind: keyof DeskCounts, value: string) => Promise<void>;
    __flushDeskCounts?: () => Promise<void>;
};

/** Retain mounted count-label text transitions across documents, not browser paints or unmounted state. */
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
        const selectors = {
            agents: '[data-testid="ip-count-all"]',
            approvals: '[data-testid="ip-approvals-open"] [data-testid="ip-approvals-count"]',
        };
        const previous: Partial<Record<keyof DeskCounts, string>> = {};
        const record = (kind: keyof DeskCounts, value: string | null | undefined) => {
            if (!value || previous[kind] === value) return;
            previous[kind] = value;
            pending.push(target.__recordDeskCount(kind, value));
        };
        const capture = (mutations: MutationRecord[]) => {
            // Text nodes may already be detached by a later mutation in this batch.
            // Use the removal record to recover their count-label ancestry.
            const removedParents = new Map<Node, Node>();
            for (const mutation of mutations) {
                for (const node of mutation.removedNodes) removedParents.set(node, mutation.target);
            }
            const countKind = (node: Node): keyof DeskCounts | null => {
                let approvals = false;
                for (let current: Node | null = node; current; current = current.parentNode ?? removedParents.get(current) ?? null) {
                    if (current.nodeType !== Node.ELEMENT_NODE) continue;
                    const id = (current as Element).getAttribute('data-testid');
                    if (id === 'ip-count-all') return 'agents';
                    if (id === 'ip-approvals-count') approvals = true;
                    if (approvals && id === 'ip-approvals-open') return 'approvals';
                }
                return null;
            };
            for (const mutation of mutations) {
                const kind = countKind(mutation.target);
                if (kind && mutation.type === 'characterData') record(kind, mutation.oldValue);
                if (mutation.type === 'childList') {
                    if (kind) record(kind, Array.from(mutation.removedNodes, node => node.textContent ?? '').join(''));
                    // Also retain a label when its whole mounted subtree was replaced.
                    for (const node of mutation.removedNodes) {
                        if (node.nodeType !== Node.ELEMENT_NODE) continue;
                        const element = node as Element;
                        for (const key of ['agents', 'approvals'] as const) {
                            if (countKind(element) === key) record(key, element.textContent);
                            for (const label of element.querySelectorAll(selectors[key])) record(key, label.textContent);
                        }
                    }
                }
            }
            for (const key of ['agents', 'approvals'] as const) record(key, document.querySelector(selectors[key])?.textContent);
        };
        const observer = new MutationObserver(capture);
        observer.observe(document, { subtree: true, childList: true, characterData: true, characterDataOldValue: true });
        capture([]);
        target.__flushDeskCounts = async () => {
            capture(observer.takeRecords());
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
