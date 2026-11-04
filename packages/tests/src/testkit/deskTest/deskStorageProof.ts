import { randomUUID } from 'node:crypto';

import { fetchJson } from '../http';
import type { DeskAccount } from './deskTest';

function isJson(value: string): boolean {
    try { JSON.parse(value); return true; } catch { return false; }
}

function decodeBase64(value: unknown): Buffer {
    if (typeof value !== 'string' || !value.length) throw new Error('Invalid encrypted base64');
    const bytes = Buffer.from(value, 'base64');
    if (!bytes.length || bytes.toString('base64') !== value) throw new Error('Invalid encrypted base64');
    return bytes;
}

/** Shape check only. deskSeed.assertPersistedEncryption is the authoritative authenticated
 * decryption proof for seeded metadata/state. This list covers the first server page only.
 * Never put payloads in assertion errors: the server rows contain encrypted material. */
export async function assertDeskStorageMode(desk: DeskAccount, mode: 'plain' | 'e2ee'): Promise<void> {
    const response = await fetchJson<{ sessions?: Array<{ encryptionMode?: unknown; dataEncryptionKey?: unknown; metadata?: unknown; agentState?: unknown }> }>(`${desk.serverBaseUrl}/v2/sessions`, {
        headers: { Authorization: `Bearer ${desk.token}` },
    });
    if (response.status !== 200 || !response.data.sessions?.length) throw new Error('Storage proof requires persisted sessions');
    for (const row of response.data.sessions) {
        if (row.encryptionMode !== mode) throw new Error(`Expected persisted ${mode} session; storage mode mismatch`);
        if (mode === 'e2ee') {
            for (const value of [row.metadata, row.agentState]) {
                if (value == null) continue;
                if (typeof value === 'string' && isJson(value)) throw new Error('Encrypted session silently fell back to plain JSON');
                const bytes = decodeBase64(value);
                if (isJson(bytes.toString('utf8'))) throw new Error('Encrypted session silently fell back to base64 plain JSON');
                // rpcCrypto AES-GCM bundle: version byte + 12-byte nonce + 16-byte tag.
                if (bytes.length < 1 + 12 + 16 || bytes[0] !== 0) throw new Error('Invalid encrypted session bundle');
            }
            decodeBase64(row.dataEncryptionKey);
        }
    }
}

/** A negative control against the same disposable E2EE server. */
export async function assertDeskRejectsPlainSession(desk: DeskAccount): Promise<void> {
    try {
        const response = await fetchJson<{ code?: unknown }>(`${desk.serverBaseUrl}/v1/sessions`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${desk.token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ tag: `desk-plain-negative-${randomUUID()}`, encryptionMode: 'plain', metadata: '{}', agentState: null, dataEncryptionKey: null }),
        });
        if (response.status === 400 && response.data?.code === 'storage_policy_requires_e2ee') return;
    } catch {
        // HTTP/parser failures may contain response data. They do not prove policy rejection.
    }
    throw new Error('Encrypted desk server did not reject plain session storage; sensitive details withheld');
}
