export type DeskUsageRow = Readonly<{
    id: 'maxWeek' | 'lastFiveHours' | 'fableShare';
    value: null;
    estimate: boolean;
}>;

export function deskUsageRows(): readonly DeskUsageRow[] {
    return [
        { id: 'maxWeek', value: null, estimate: false },
        { id: 'lastFiveHours', value: null, estimate: false },
        { id: 'fableShare', value: null, estimate: true },
    ];
}
