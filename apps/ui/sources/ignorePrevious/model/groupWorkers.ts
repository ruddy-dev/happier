import { BULB_RANK, issueBulb, type Bulb } from './bulb';

export type WorkerRow = {
    sessionId: string;
    title: string;
    issueKey: string | null;
    bulb: Bulb;
    /** Null until the session's full record has loaded. */
    permissionMode: string | null;
    updatedAt: number;
    /** How close to auto-compact, 0–100; absent until the session has reported its context. */
    contextPercent?: number | null;
    /** The worker is mid-turn or held at a prompt, so its turn can be stopped. */
    canStop?: boolean;
    /** The worker's session isn't running; opening it lets its session view resume it. */
    inactive?: boolean;
};

export type IssueGroup = {
    issueKey: string | null;
    bulb: Bulb;
    workers: WorkerRow[];
};

/** Issue groups for the Work column: most urgent first, then most recent; workers without an issue last. */
export function groupWorkersByIssue(rows: readonly WorkerRow[]): IssueGroup[] {
    const byKey = new Map<string | null, WorkerRow[]>();
    for (const row of rows) {
        const list = byKey.get(row.issueKey);
        if (list) list.push(row);
        else byKey.set(row.issueKey, [row]);
    }
    const groups = [...byKey].map(([issueKey, workers]) => {
        workers.sort((a, b) => b.updatedAt - a.updatedAt);
        return { issueKey, bulb: issueBulb(workers.map((w) => w.bulb)), workers };
    });
    return groups.sort((a, b) => {
        if ((a.issueKey === null) !== (b.issueKey === null)) return a.issueKey === null ? 1 : -1;
        return BULB_RANK[a.bulb] - BULB_RANK[b.bulb] || b.workers[0].updatedAt - a.workers[0].updatedAt;
    });
}
