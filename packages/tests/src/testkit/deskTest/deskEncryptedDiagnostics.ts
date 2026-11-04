import type { Page } from '@playwright/test';

// Nominated route categories only. Never return a host, query, identifier or arbitrary path.
function endpointCategory(url: string): string {
    let path: string;
    try { path = new URL(url).pathname; } catch { return 'other'; }
    const exact = ['/', '/desk', '/restore/manual', '/v1/auth', '/v1/features', '/v1/account/profile', '/v1/account/encryption', '/v1/sessions', '/v2/sessions', '/v1/updates', '/socket.io/'];
    if (exact.includes(path)) return path;
    if (path.startsWith('/v1/sessions/')) return '/v1/sessions/*';
    if (path.startsWith('/v2/sessions/')) return '/v2/sessions/*';
    return 'other';
}

function errorClass(error: unknown): string {
    if (!(error instanceof Error)) return 'unknown-error';
    if (error.cause instanceof Error) return errorClass(error.cause);
    const line = error.message.split('\n')[0].replace(/^desk guard failed for \S+: /, '');
    if (line.startsWith('desk test reached origins it must not:')) return 'origin-refused';
    if (line.startsWith('desk guard stuck after ')) return 'guard-drain-timeout';
    if (/Max redirect count exceeded/.test(line)) return 'redirect-limit';
    if (/Target page, context or browser has been closed/.test(line)) return 'closed-target';
    if (/Response has been disposed/i.test(line)) return 'response-disposed';
    if (/Request context disposed/i.test(line)) return 'request-context-disposed';
    if (/Timeout|timed out|ETIMEDOUT/.test(line)) return 'timeout';
    if (/ECONNRESET|ERR_CONNECTION_RESET|socket hang up/.test(line)) return 'connection-reset';
    if (/ECONNREFUSED|ERR_CONNECTION_REFUSED/.test(line)) return 'connection-refused';
    if (/ERR_ABORTED|AbortError/.test(line)) return 'aborted';
    if (/ERR_BLOCKED_BY_CLIENT/.test(line)) return 'blocked-by-client';
    if (error instanceof TypeError) return 'type-error';
    return 'unclassified-error';
}

type SafeDiagnostic = { errorClass: string; endpoint: string; status: number | null };

class SanitizedDeskGuardError extends Error {}

/** Preserve guard failures, but never propagate their message, stack, cause or call log. */
export function encryptedDeskGuardError(error: unknown): Error {
    const records: SafeDiagnostic[] = [];
    const visit = (failure: unknown) => {
        if (failure instanceof AggregateError) {
            for (const child of failure.errors) visit(child);
            return;
        }
        const message = failure instanceof Error ? failure.message : '';
        // Read URLs only from the guard's own wrapper. Text inside a transport call log
        // does not nominate an endpoint and must not be treated as diagnostic evidence.
        const guardLine = /^(?:desk guard failed for |desk test reached origins it must not: |desk guard stuck after )/.test(message)
            ? message.split('\n')[0] : '';
        const urls = guardLine.match(/(?:https?|wss?):\/\/[^\s,]+/g) ?? [];
        const endpoints = urls.length ? [...new Set(urls.map(url => endpointCategory(url.replace(/:$/, ''))))] : ['other'];
        for (const endpoint of endpoints) records.push({ errorClass: errorClass(failure), endpoint, status: null });
    };
    visit(error);
    return new SanitizedDeskGuardError(`Encrypted desk guard failed: ${JSON.stringify(records)}`);
}

/** Outcome classes only; response bodies, headers, console messages and raw failures are never retained. */
export function collectEncryptedDeskDiagnostics(page: Page): () => string {
    const records = new Set<string>();
    const record = (entry: SafeDiagnostic) => { records.add(JSON.stringify(entry)); };
    page.on('response', response => {
        record({ errorClass: 'http-response', endpoint: endpointCategory(response.url()), status: response.status() });
    });
    page.on('requestfailed', request => {
        record({ errorClass: errorClass(new Error(request.failure()?.errorText ?? '')), endpoint: endpointCategory(request.url()), status: null });
    });
    page.on('pageerror', error => { record({ errorClass: errorClass(error), endpoint: 'other', status: null }); });
    return () => `Encrypted desk diagnostics: [${[...records].join(',')}]`;
}

export type EncryptedDeskSignupStep = 'UI' | 'encryption mode' | 'profile' | 'key derivation';

class EncryptedDeskSignupError extends Error {
    constructor(readonly step: EncryptedDeskSignupStep) {
        super(`Encrypted desk signup: ${step} failed; sensitive details withheld`);
    }
}

function isGuardFailure(error: unknown): boolean {
    if (error instanceof AggregateError) return error.errors.length > 0 && error.errors.every(isGuardFailure);
    return error instanceof Error && /^(?:desk guard failed for |desk test reached origins it must not: |desk guard stuck after )/.test(error.message);
}

/** Only guard failures are guard evidence. Account failures retain a closed step label. */
export function encryptedDeskSignupError(error: unknown, step: EncryptedDeskSignupStep): Error {
    if (error instanceof SanitizedDeskGuardError) return error;
    if (error instanceof EncryptedDeskSignupError) return new EncryptedDeskSignupError(error.step);
    if (isGuardFailure(error)) return encryptedDeskGuardError(error);
    return new EncryptedDeskSignupError(step);
}
