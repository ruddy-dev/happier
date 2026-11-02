import { describe, expect, it } from 'vitest';
import { initialRunSettings, offersUltracode, runSettingsReducer, runEffortControl } from './runSettings';

describe('desk run settings', () => {
    it('M9 clears Ultracode when leaving an offered model and does not restore it', () => {
        const on = runSettingsReducer(initialRunSettings, { type: 'ultracode', enabled: true });
        expect(on.ultracode).toBe(true);
        const haiku = runSettingsReducer(on, { type: 'model', model: 'claude-haiku-5-5' });
        expect(haiku.ultracode).toBe(false);
        expect(runSettingsReducer(haiku, { type: 'model', model: 'claude-opus-5-5' }).ultracode).toBe(false);
    });
    it('M10 narrows the shared support facts to the three desk offers', () => {
        for (const id of ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-fable-5-1']) expect(offersUltracode(id)).toBe(true);
        for (const id of ['default', 'claude-haiku-5-5', 'claude-opus-5', 'claude-opus-4-7']) expect(offersUltracode(id)).toBe(false);
        const defaultModel = runSettingsReducer(initialRunSettings, { type: 'model', model: 'default' });
        expect(runSettingsReducer(defaultModel, { type: 'ultracode', enabled: true }).ultracode).toBe(false);
    });
    it.each(['claude-haiku-5-5', 'default'] as const)('M3 preserves stored effort and rejects picks for %s', model => {
        const unsupported = runSettingsReducer(initialRunSettings, { type: 'model', model });
        expect(runEffortControl(unsupported).disabled).toBe(true);
        expect(runSettingsReducer(unsupported, { type: 'effort', effort: 'low' })).toBe(unsupported);
        const restored = runSettingsReducer(unsupported, { type: 'model', model: 'claude-opus-5-5' });
        expect(restored.effort).toBe('high');
        expect(runEffortControl(restored).disabled).not.toBe(true);
    });
    it('M10 locks effective effort at xhigh while preserving the selected effort', () => {
        const on = runSettingsReducer(initialRunSettings, { type: 'ultracode', enabled: true });
        expect(runEffortControl(on)).toMatchObject({ disabled: true, effectiveValue: 'xhigh' });
        expect(runSettingsReducer(on, { type: 'effort', effort: 'low' })).toBe(on);
        const off = runSettingsReducer(on, { type: 'ultracode', enabled: false });
        expect(runEffortControl(off)).toMatchObject({ effectiveValue: 'high' });
        expect(runEffortControl(off).disabled).not.toBe(true);
    });
});
