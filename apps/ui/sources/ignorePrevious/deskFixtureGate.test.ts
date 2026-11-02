import { afterEach, describe, expect, it, vi } from 'vitest';

import { isDeskFixtureBuild } from './deskFixtureGate';

describe('isDeskFixtureBuild', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it.each([
        ['1', true],
        ['', false],
        ['0', false],
        ['true', false],
        [' 1', false],
        ['1 ', false],
    ])('is %j -> %s', (value, expected) => {
        vi.stubEnv('EXPO_PUBLIC_IP_FIXTURES', value);
        expect(isDeskFixtureBuild()).toBe(expected);
    });

    it('is off when the flag is unset', () => {
        vi.stubEnv('EXPO_PUBLIC_IP_FIXTURES', undefined as unknown as string);
        expect(isDeskFixtureBuild()).toBe(false);
    });
});
