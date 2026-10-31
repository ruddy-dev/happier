import { describe, expect, it } from 'vitest';

import { contextMeter } from './contextMeter';

describe('contextMeter', () => {
    it('measures towards the auto-compact limit when one is set below the window', () => {
        expect(contextMeter({ used: 110_000, windowTokens: 1_000_000, compactAt: 220_000 })).toEqual({
            used: 110_000,
            limit: 220_000,
            towardsCompact: true,
            ratio: 0.5,
            windowTokens: 1_000_000,
        });
    });

    it('measures against the model window when no compact limit is known', () => {
        const meter = contextMeter({ used: 50_000, windowTokens: 200_000, compactAt: null });
        expect(meter).toMatchObject({ limit: 200_000, towardsCompact: false, ratio: 0.25 });
    });

    it('ignores a compact limit above the window and caps the ratio at full', () => {
        const meter = contextMeter({ used: 300_000, windowTokens: 200_000, compactAt: 220_000 });
        expect(meter).toMatchObject({ limit: 200_000, towardsCompact: false, ratio: 1 });
    });
});
