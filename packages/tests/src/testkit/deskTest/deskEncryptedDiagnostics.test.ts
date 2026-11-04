import { expect, it } from 'vitest';
import type { Page, Request, Response } from '@playwright/test';

import { collectEncryptedDeskDiagnostics, encryptedDeskGuardError } from './deskEncryptedDiagnostics';

it('separates a guarded polling transport failure from a policy refusal without raw call logs', () => {
    const cause = new Error('route.fetch: socket hang up\nCall log:\n Authorization: Bearer PRIVATE');
    const error = new Error('desk guard failed for http://127.0.0.1:23456/socket.io/?sid=PRIVATE: socket hang up', { cause });
    expect(encryptedDeskGuardError(error).message).toBe('Encrypted desk guard failed: [{"errorClass":"connection-reset","endpoint":"/socket.io/","status":null}]');
    expect(encryptedDeskGuardError(error).cause).toBeUndefined();
});

it('records actual HTTP status and failure classes without calling headers, body or console APIs', () => {
    const handlers: Record<string, (event: unknown) => void> = {};
    const page = { on: (name: string, callback: (event: unknown) => void) => { handlers[name] = callback; } } as unknown as Page;
    const read = collectEncryptedDeskDiagnostics(page);
    handlers.response({ url: () => 'http://private.invalid/v1/auth?key=PRIVATE', status: () => 401 } as Response);
    handlers.response({ url: () => 'http://private.invalid/v1/sessions/PRIVATE', status: () => 200 } as Response);
    handlers.requestfailed({ url: () => 'http://private.invalid/socket.io/?sid=PRIVATE', failure: () => ({ errorText: 'net::ERR_CONNECTION_RESET private-text' }) } as Request);
    handlers.pageerror(new TypeError('PRIVATE'));
    expect(read()).toBe('Encrypted desk diagnostics: [{"errorClass":"http-response","endpoint":"/v1/auth","status":401},{"errorClass":"http-response","endpoint":"/v1/sessions/*","status":200},{"errorClass":"connection-reset","endpoint":"/socket.io/","status":null},{"errorClass":"type-error","endpoint":"other","status":null}]');
    expect(handlers.console).toBeUndefined();
});

it('retains refusal as a failure, redacting session path, query, host and body', () => {
    const error = new Error('desk test reached origins it must not: https://private.invalid/v1/sessions/PRIVATE?key=PRIVATE (not on the allowed list)');
    expect(encryptedDeskGuardError(error).message).toBe('Encrypted desk guard failed: [{"errorClass":"origin-refused","endpoint":"/v1/sessions/*","status":null}]');
});

it('reports independent aggregate causes, with only nominated paths and closed error classes', () => {
    const error = new AggregateError([
        new Error('desk guard failed for http://private.invalid/v1/auth?secret=PRIVATE: route.fetch: Timeout 30000ms exceeded'),
        new Error('desk guard failed for http://private.invalid/user-content-PRIVATE: route.fulfill: Response has been disposed'),
    ]);
    expect(encryptedDeskGuardError(error).message).toBe('Encrypted desk guard failed: [{"errorClass":"timeout","endpoint":"/v1/auth","status":null},{"errorClass":"response-disposed","endpoint":"other","status":null}]');
});

it.each(['UI', 'encryption mode', 'profile', 'key derivation'] as const)('preserves the signup %s stage without exposing the original failure', async step => {
    const { encryptedDeskSignupError } = await import('./deskEncryptedDiagnostics');
    const failure = encryptedDeskSignupError(new Error('PRIVATE transport details', { cause: new Error('PRIVATE') }), step);
    expect(failure.message).toBe(`Encrypted desk signup: ${step} failed; sensitive details withheld`);
    expect(failure.cause).toBeUndefined();
    // The fixture sanitises the account helper's already-safe failure a second time.
    expect(encryptedDeskSignupError(failure, 'UI').message).toBe(failure.message);
});

it('retains classified guard errors during signup, including aggregates', async () => {
    const { encryptedDeskSignupError } = await import('./deskEncryptedDiagnostics');
    const guard = new AggregateError([new Error('desk guard failed for http://private.invalid/v1/auth: ECONNRESET')]);
    const safe = encryptedDeskSignupError(guard, 'UI');
    expect(safe.message).toBe(encryptedDeskGuardError(guard).message);
    expect(encryptedDeskSignupError(safe, 'UI').message).toBe(safe.message);
    const mixed = new AggregateError([guard, new Error('PRIVATE')]);
    expect(encryptedDeskSignupError(mixed, 'profile').message).toBe('Encrypted desk signup: profile failed; sensitive details withheld');
});
