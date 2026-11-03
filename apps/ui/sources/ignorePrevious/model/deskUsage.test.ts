import { expect, it } from 'vitest';
import { deskUsageRows } from './deskUsage';

it('M12: unavailable desk usage preserves row order and labels Fable as an estimate', () => {
    expect(deskUsageRows()).toEqual([
        { id: 'maxWeek', value: null, estimate: false },
        { id: 'lastFiveHours', value: null, estimate: false },
        { id: 'fableShare', value: null, estimate: true },
    ]);
});
