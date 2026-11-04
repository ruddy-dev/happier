import { expect, test, vi } from 'vitest';
import { RPC_METHODS } from '@happier-dev/protocol/rpc';
import { createTransferRecipientKeyPair, decryptEncryptedTransferChunkEnvelope } from '@/machines/transfer/transferChunkEncryption';
import { createJ4FileResponder, registerJ4Machine } from './j4Machine';

const boundary = vi.hoisted(() => ({ machine: undefined as ReturnType<typeof socket> | undefined, session: undefined as ReturnType<typeof socket> | undefined, registrations: [] as string[] }));
vi.mock('../socketClient', () => ({ createMachineScopedSocketCollector: () => boundary.machine, createSessionScopedSocketCollector: () => boundary.session }));
vi.mock('../http', () => ({ fetchJson: async (url: string, init?: { body?: string }) => { if (url.endsWith('/v1/machines') && init?.body) boundary.registrations.push(init.body); return { status: 200, data: { machine: { active: true } } }; } }));

function socket() {
    return { connect: vi.fn(), close: vi.fn(), isConnected: () => true, emit: vi.fn(), onRpcRequest: vi.fn(), rpcRegister: vi.fn(async (_method: string) => {}) };
}

test('registers production-owned methods and announces machine presence', async () => {
    boundary.machine = socket();
    boundary.session = socket();
    const fixture = await registerJ4Machine({ baseUrl: 'http://127.0.0.1', token: 'test', machineId: 'machine', sessionId: 'session', handle: () => ({ success: true }) });
    const registration = JSON.parse(boundary.registrations.at(-1)!);
    expect(registration.id).toBe('machine');
    expect(registration.dataEncryptionKey).toBeTruthy();
    const transfer = [RPC_METHODS.DAEMON_BULK_TRANSFER_DOWNLOAD_INIT, RPC_METHODS.DAEMON_BULK_TRANSFER_DOWNLOAD_CHUNK, RPC_METHODS.DAEMON_BULK_TRANSFER_DOWNLOAD_FINALIZE, RPC_METHODS.DAEMON_BULK_TRANSFER_DOWNLOAD_ABORT];
    expect(boundary.machine.emit).toHaveBeenCalledWith('machine-alive', expect.objectContaining({ machineId: 'machine', time: expect.any(Number) }));
    expect(boundary.machine.rpcRegister.mock.calls.map(([method]: [string]) => method)).toEqual([RPC_METHODS.STAT_FILE, ...transfer].map(method => `machine:${method}`));
    expect(boundary.session.rpcRegister.mock.calls.map(([method]: [string]) => method)).toEqual(transfer.map(method => `session:${method}`));
    fixture.close();
    expect(boundary.machine.close).toHaveBeenCalledOnce();
    expect(boundary.session.close).toHaveBeenCalledOnce();
});

test('serves only synthetic files through the real encrypted transfer envelope and releases downloads', () => {
    const path = '/tmp/desk-fixture/work/projects.json';
    const bytes = Buffer.from(JSON.stringify({ ATR: { name: 'Example project' } }));
    const fixture = createJ4FileResponder(new Map([[path, bytes]]));
    const key = createTransferRecipientKeyPair();
    expect(fixture.handle(RPC_METHODS.STAT_FILE, { path })).toMatchObject({ success: true, exists: true, kind: 'file', sizeBytes: bytes.length });
    expect(fixture.handle(RPC_METHODS.STAT_FILE, { path: '/not-a-synthetic-file' })).toEqual({ success: true, exists: false });
    expect(fixture.handle(RPC_METHODS.DAEMON_BULK_TRANSFER_DOWNLOAD_INIT, { t: 'session_file_download_v1', path, recipientPublicKeyBase64: 'invalid' })).toMatchObject({ success: false });
    const init = fixture.handle(RPC_METHODS.DAEMON_BULK_TRANSFER_DOWNLOAD_INIT, { t: 'session_file_download_v1', path, recipientPublicKeyBase64: key.recipientPublicKeyBase64 });
    if (!('downloadId' in init) || typeof init.downloadId !== 'string') throw new Error('Synthetic init failed');
    const chunk = fixture.handle(RPC_METHODS.DAEMON_BULK_TRANSFER_DOWNLOAD_CHUNK, { downloadId: init.downloadId, index: 0 });
    if (!('payloadBase64' in chunk) || typeof chunk.payloadBase64 !== 'string' || !('encryptedDataKeyEnvelopeBase64' in chunk) || typeof chunk.encryptedDataKeyEnvelopeBase64 !== 'string') throw new Error('Synthetic encrypted chunk missing');
    expect(chunk).toMatchObject({ success: true, isLast: true });
    expect(decryptEncryptedTransferChunkEnvelope({ transferId: init.downloadId, sequence: 0, payloadBase64: chunk.payloadBase64, encryptedDataKeyEnvelopeBase64: chunk.encryptedDataKeyEnvelopeBase64, recipientSecretKeySeed: key.recipientSecretKeySeed })).toEqual(bytes);
    expect(fixture.handle(RPC_METHODS.DAEMON_BULK_TRANSFER_DOWNLOAD_CHUNK, { downloadId: init.downloadId, index: 0 })).toMatchObject({ success: false });
    expect(fixture.handle(RPC_METHODS.DAEMON_BULK_TRANSFER_DOWNLOAD_FINALIZE, { downloadId: init.downloadId })).toEqual({ success: true });
    expect(fixture.handle(RPC_METHODS.DAEMON_BULK_TRANSFER_DOWNLOAD_CHUNK, { downloadId: init.downloadId, index: 1 })).toMatchObject({ success: false });
    fixture.close();
});
