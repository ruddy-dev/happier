import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderScreen } from '@/dev/testkit';
import { createSessionFixture } from '@/dev/testkit/fixtures/sessionFixtures';
import type { Session } from '@/sync/domains/state/storageTypes';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

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

async function renderMeter(session: Session) {
    const { ContextMeter } = await import('./ContextMeter');
    return renderScreen(<ContextMeter session={session} />);
}

describe('ContextMeter', () => {
    afterEach(() => vi.unstubAllEnvs());

    it('shows how far the session is towards auto-compact, and the model window', async () => {
        vi.stubEnv('EXPO_PUBLIC_IP_AUTOCOMPACT_CLAUDE', '220000');
        const screen = await renderMeter(claudeSession(110_000));
        expect(screen.findByTestId('ip-context-percent')?.props.children).toBe(50);
        const text = screen.getTextContent();
        expect(text).toContain('220k');
        expect(text).toContain('1M');
    });

    it('shows nothing until the session has reported its context', async () => {
        const screen = await renderMeter(claudeSession(null));
        expect(screen.findByTestId('ip-context-percent')).toBeNull();
    });
});
