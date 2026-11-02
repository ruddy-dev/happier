import { afterEach, describe, expect, it, vi } from 'vitest';
import { isPublicRouteForUnauthenticated } from './authRouting';

describe('isPublicRouteForUnauthenticated', () => {
    const routeCases: Array<{ name: string; segments: string[]; expected: boolean }> = [
        { name: 'empty root', segments: [], expected: true },
        { name: 'group-only route', segments: ['(app)'], expected: true },
        { name: 'home index', segments: ['index'], expected: true },
        { name: 'grouped home index', segments: ['(app)', 'index'], expected: true },
        { name: 'nested home index', segments: ['(app)', '(group)', 'index'], expected: true },
        { name: 'setup route', segments: ['setup'], expected: true },
        { name: 'nested setup route', segments: ['(app)', 'setup'], expected: true },
        { name: 'server route', segments: ['server'], expected: true },
        { name: 'nested server route', segments: ['(app)', 'server', 'saved'], expected: true },
        { name: 'settings server route', segments: ['settings', 'server'], expected: true },
        { name: 'grouped settings server route', segments: ['(app)', 'settings', 'server'], expected: true },
        { name: 'restore route', segments: ['restore'], expected: true },
        { name: 'nested restore route', segments: ['(app)', 'restore', 'lost-access'], expected: true },
        { name: 'share route', segments: ['share'], expected: true },
        { name: 'nested share route', segments: ['(app)', 'share', 'abc123'], expected: true },
        { name: 'terminal route', segments: ['terminal'], expected: true },
        { name: 'nested terminal route', segments: ['(app)', 'terminal', 'connect'], expected: true },
        { name: 'account connect route', segments: ['account'], expected: true },
        { name: 'grouped account connect route', segments: ['(app)', 'account'], expected: true },
        { name: 'mTLS callback route', segments: ['mtls'], expected: true },
        { name: 'grouped mTLS callback route', segments: ['(app)', 'mtls'], expected: true },
        { name: 'desktop pet overlay route', segments: ['desktop', 'pet-overlay'], expected: true },
        { name: 'nested desktop pet overlay route', segments: ['(app)', 'desktop', 'pet-overlay'], expected: true },
        { name: 'oauth return route', segments: ['oauth', 'github'], expected: true },
        { name: 'grouped oauth return route', segments: ['(app)', 'oauth', 'github'], expected: true },
        { name: 'private settings route', segments: ['settings'], expected: false },
        { name: 'grouped private settings route', segments: ['(app)', 'settings'], expected: false },
        { name: 'private non-server settings route', segments: ['(app)', 'settings', 'features'], expected: false },
        { name: 'unknown private route', segments: ['inbox'], expected: false },
        { name: 'nested unknown private route', segments: ['(app)', 'session', '[id]'], expected: false },
        { name: 'ambiguous grouped segment only', segments: ['(auth)', '(protected)'], expected: true },
        { name: 'case-sensitive route mismatch', segments: ['Server'], expected: false },
    ];

    it.each(routeCases)('$name', ({ segments, expected }) => {
        expect(isPublicRouteForUnauthenticated(segments)).toBe(expected);
    });
});

describe('isPublicRouteForUnauthenticated: dev-only desk fixture', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('is public only when the build has EXPO_PUBLIC_IP_FIXTURES=1', () => {
        vi.stubEnv('EXPO_PUBLIC_IP_FIXTURES', '1');
        expect(isPublicRouteForUnauthenticated(['(app)', 'dev', 'desk-fixture'])).toBe(true);
        expect(isPublicRouteForUnauthenticated(['dev', 'desk-fixture'])).toBe(true);
    });

    it('stays private with the flag off', () => {
        vi.stubEnv('EXPO_PUBLIC_IP_FIXTURES', '');
        expect(isPublicRouteForUnauthenticated(['(app)', 'dev', 'desk-fixture'])).toBe(false);
        vi.stubEnv('EXPO_PUBLIC_IP_FIXTURES', '0');
        expect(isPublicRouteForUnauthenticated(['(app)', 'dev', 'desk-fixture'])).toBe(false);
    });

    it('opens no other dev route, with the flag on', () => {
        vi.stubEnv('EXPO_PUBLIC_IP_FIXTURES', '1');
        expect(isPublicRouteForUnauthenticated(['(app)', 'dev', 'logs'])).toBe(false);
        expect(isPublicRouteForUnauthenticated(['(app)', 'dev'])).toBe(false);
        expect(isPublicRouteForUnauthenticated(['(app)', 'desk'])).toBe(false);
    });
});
