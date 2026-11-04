import { randomBytes } from 'node:crypto';
import tweetnacl from 'tweetnacl';
import { sealEncryptedDataKeyEnvelopeV1 } from '@happier-dev/protocol';
import { afterEach, expect, it, vi } from 'vitest';

import { encryptDataKeyBase64 } from '../rpcCrypto';
import { assertDeskStorageMode, assertDeskRejectsPlainSession } from './deskStorageProof';

const desk = { serverBaseUrl: 'http://127.0.0.1:23456', token: 'disposable-token', uiBaseUrl: '', proxyBaseUrl: '' };
function encryptedRow() {
    const key = randomBytes(32);
    return {
        encryptionMode: 'e2ee',
        dataEncryptionKey: Buffer.from(sealEncryptedDataKeyEnvelopeV1({
            dataKey: key, recipientPublicKey: tweetnacl.box.keyPair().publicKey, randomBytes,
        })).toString('base64'),
        metadata: encryptDataKeyBase64({ name: 'Synthetic session' }, key),
        agentState: encryptDataKeyBase64({}, key),
    };
}
function respond(row: unknown) {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ sessions: [row] }), { status: 200 })));
}
afterEach(() => vi.unstubAllGlobals());

it('accepts real encrypted bundles without treating shape validation as decryption proof', async () => {
    respond(encryptedRow());
    await expect(assertDeskStorageMode(desk, 'e2ee')).resolves.toBeUndefined();
});

it.each(['plain row', 'plain JSON', 'base64 JSON', 'short bundle', 'invalid base64', 'invalid wrapped key'])(
    'rejects %s without reporting payloads', async kind => {
        const row = encryptedRow();
        const plain = JSON.stringify({ name: 'Synthetic plaintext longer than a cipher header and tag' });
        if (kind === 'plain row') row.encryptionMode = 'plain';
        if (kind === 'plain JSON') row.metadata = plain;
        if (kind === 'base64 JSON') row.agentState = Buffer.from(plain).toString('base64');
        if (kind === 'short bundle') row.metadata = Buffer.from([0, 1]).toString('base64');
        if (kind === 'invalid base64') row.metadata = '!'.repeat(100);
        if (kind === 'invalid wrapped key') row.dataEncryptionKey = '!'.repeat(100);
        respond(row);
        await expect(assertDeskStorageMode(desk, 'e2ee')).rejects.toThrow(/storage mode mismatch|plain JSON|Invalid encrypted/);
    },
);

it.each([
    { status: 200, code: undefined },
    { status: 400, code: 'unrelated-rejection' },
    { status: 400, code: 'storage_policy_requires_e2ee' },
])('requires the specific server refusal for the plain negative control: $status / $code', async ({ status, code }) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code }), { status })));
    const proof = assertDeskRejectsPlainSession(desk);
    if (code === 'storage_policy_requires_e2ee') await expect(proof).resolves.toBeUndefined();
    else await expect(proof).rejects.toThrow('Encrypted desk server did not reject plain session storage');
});
