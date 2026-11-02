import { afterEach, expect, it, vi } from 'vitest';
import { sessionContextMeter } from './ContextMeter';
import { createSessionFixture } from '@/dev/testkit/fixtures/sessionFixtures';
import type { Session } from '@/sync/domains/state/storageTypes';

afterEach(() => vi.unstubAllEnvs());

function claudeSession(contextSize: number | null): Session {
    return createSessionFixture({
        id: 's1',
        metadata: { path: '/p', host: 'h', homeDir: '/h', machineId: 'm', flavor: 'claude' } as Session['metadata'],
        latestUsage: contextSize === null ? null : {
            inputTokens: 0, outputTokens: 0, cacheCreation: 0, cacheRead: 0,
            contextSize, contextSizeIsReported: true, contextWindowTokens: 1_000_000, timestamp: 1,
        },
    });
}

it('C9 uses one session owner for compact and window percentages and the setting source', () => {
    vi.stubEnv('EXPO_PUBLIC_IP_AUTOCOMPACT_CLAUDE', '220000');
    expect(sessionContextMeter(claudeSession(95_500))).toMatchObject({
        percent: 43, limit: 220_000, towardsCompact: true,
        compactSetting: 'EXPO_PUBLIC_IP_AUTOCOMPACT_CLAUDE',
    });
    vi.stubEnv('EXPO_PUBLIC_IP_AUTOCOMPACT_CLAUDE', '');
    expect(sessionContextMeter(claudeSession(95_500))).toMatchObject({ percent: 10, limit: 1_000_000, towardsCompact: false });
    expect(sessionContextMeter(claudeSession(null))).toBeNull();
});
