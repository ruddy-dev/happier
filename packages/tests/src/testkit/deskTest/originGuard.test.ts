import { expect, test } from 'vitest';
import { forbiddenOriginLabel, isAllowedOrigin } from './originGuard';

test('extra forbidden probe origins override even an explicit allow, for HTTP and websockets', () => {
    const origin = 'http://127.0.0.1:23456';
    expect(isAllowedOrigin(`${origin}/probe`, [origin], [origin])).toBe(false);
    expect(isAllowedOrigin('ws://127.0.0.1:23456/socket', [origin], [origin])).toBe(false);
    expect(forbiddenOriginLabel(`${origin}/probe`, [origin])).toBe('a test-only forbidden origin');
});

test('real destinations are refused without any network, even when explicitly allowed', () => {
    for (const url of ['http://127.0.0.1:3005/', 'https://api.happier.dev/', 'https://box.tail1234.ts.net/']) {
        expect(isAllowedOrigin(url, [url])).toBe(false);
        expect(forbiddenOriginLabel(url)).not.toBeNull();
    }
    expect(isAllowedOrigin('http://127.0.0.1:23456/', ['http://127.0.0.1:23456'])).toBe(true);
});
