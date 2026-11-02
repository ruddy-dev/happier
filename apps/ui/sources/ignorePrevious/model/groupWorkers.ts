import { BULB_RANK, issueBulb, type Bulb } from './bulb';

export type WorkerRow = {
    sessionId: string;
    title: string;
    issueKey: string | null;
    bulb: Bulb;
    /** Null until the session's full record has loaded. */
    permissionMode: string | null;
    updatedAt: number;
    /** Latest activity observation, excluding keep-alives; metadata is a fallback before activity exists. */
    lastActivityAt?: number | null;
    /** How close to auto-compact, 0–100; absent until the session has reported its context. */
    contextPercent?: number | null;
    /** The worker is busy, including background or resuming work, so Stop is available. */
    canStop?: boolean;
    /** Minutes since the last worker signal, only when the canonical freshness budget expired. */
    unheardMinutes?: number | null;
    /** The worker's session isn't running; opening it lets its session view resume it. */
    inactive?: boolean;
};

export type IssueGroup = {
    issueKey: string | null;
    bulb: Bulb;
    workers: WorkerRow[];
};

function recency(row: WorkerRow): number {
    return row.lastActivityAt ?? row.updatedAt;
}

/** All Work groups, including No issue: urgency, then recency, then issue key (null last on exact ties). */
export function groupWorkersByIssue(rows: readonly WorkerRow[]): IssueGroup[] {
    const byKey = new Map<string | null, WorkerRow[]>();
    for (const row of rows) {
        const list = byKey.get(row.issueKey);
        if (list) list.push(row);
        else byKey.set(row.issueKey, [row]);
    }
    const groups = [...byKey].map(([issueKey, workers]) => {
        workers.sort((a, b) => recency(b) - recency(a));
        return { issueKey, bulb: issueBulb(workers.map((w) => w.bulb)), workers };
    });
    return groups.sort((a, b) => {
        const priority = BULB_RANK[a.bulb] - BULB_RANK[b.bulb] || recency(b.workers[0]) - recency(a.workers[0]);
        if (priority !== 0) return priority;
        if ((a.issueKey === null) !== (b.issueKey === null)) return a.issueKey === null ? 1 : -1;
        const aKey = a.issueKey ?? '';
        const bKey = b.issueKey ?? '';
        return aKey < bKey ? -1 : aKey > bKey ? 1 : 0;
    });
}
