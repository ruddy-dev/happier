import { describe, expect, it } from 'vitest';

import { contextMeter } from './contextMeter';

describe('contextMeter', () => {
    it('measures towards the auto-compact limit when one is set below the window', () => {
        expect(contextMeter({ used: 110_000, windowTokens: 1_000_000, compactAt: 220_000 })).toEqual({
            used: 110_000,
            limit: 220_000,
            towardsCompact: true,
            ratio: 0.5,
            percent: 50,
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

// The display retains overshoot while the bar stays bounded.
it.each([[209_000, 95], [220_000, 100], [242_000, 110]])('L11 keeps %i tokens visible as %i percent near and past 220K', (used, percent) => {
    expect(contextMeter({ used, windowTokens: 1_000_000, compactAt: 220_000 }))
        .toMatchObject({ percent, ratio: Math.min(percent / 100, 1) });
});
