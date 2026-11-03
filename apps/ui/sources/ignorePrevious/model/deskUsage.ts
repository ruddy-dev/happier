/** Exact Max account identity and the authority supplying its figures, not a profile label. */
export type DeskUsageScope = Readonly<{
    /** Includes the supplying session when the authority is session-scoped. */
    sourceId: string;
    accountId: string;
}>;

/**
 * Input boundary for an authority that has verified the exact Max account.
 * Values are percentages used; Fable share is a separately supplied estimate.
 * Provider/profile snapshots, context tokens and reset metadata are not this contract.
 * There is currently no desk producer. Omit the input when identity or values are unknown.
 */
export type DeskUsageInput = Readonly<{
    scope: DeskUsageScope | null;
    snapshot: Readonly<{
        scope: DeskUsageScope;
        maxWeek: number | null;
        lastFiveHours: number | null;
        fableShare: number | null;
    }> | null;
}>;

export type DeskUsageRow = Readonly<{
    id: 'maxWeek' | 'lastFiveHours' | 'fableShare';
    value: number | null;
    estimate: boolean;
}>;

/** One projection for both inline and panel. Never retain a previous scope's values. */
export function deskUsageRows(input?: DeskUsageInput): readonly DeskUsageRow[] {
    const scope = input?.scope;
    const snapshot = input?.snapshot;
    const matches = scope && snapshot
        && scope.sourceId.trim().length > 0 && scope.accountId.trim().length > 0
        && scope.sourceId === snapshot.scope.sourceId && scope.accountId === snapshot.scope.accountId;
    const value = (id: DeskUsageRow['id']): number | null => {
        const percent = matches ? snapshot[id] : null;
        return typeof percent === 'number' && Number.isFinite(percent) && percent >= 0 ? percent : null;
    };
    return [
        { id: 'maxWeek', value: value('maxWeek'), estimate: false },
        { id: 'lastFiveHours', value: value('lastFiveHours'), estimate: false },
        { id: 'fableShare', value: value('fableShare'), estimate: true },
    ];
}
