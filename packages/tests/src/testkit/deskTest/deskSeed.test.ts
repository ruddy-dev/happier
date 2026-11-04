import { randomBytes } from 'node:crypto';
import tweetnacl from 'tweetnacl';
import { deriveAccountMachineKeyFromRecoverySecret, openEncryptedDataKeyEnvelopeV1 } from '@happier-dev/protocol';
import { assertDeskStorageMode } from './deskStorageProof';
import { decryptDataKeyBase64, encryptDataKeyBase64 } from '../rpcCrypto';
import { afterEach, expect, test, vi } from 'vitest';
import type { SocketCollector } from '../socketClient';
import { createDeskSeeder } from './deskSeed';
import { encrypt, encodeBase64 } from '@/api/encryption';

const boundary = vi.hoisted(() => ({ sockets: [] as unknown[], sessionBody: null as Record<string, unknown> | null }));
// HTTP and socket collectors are network boundaries; session parsing and SyntheticAgent run real.
vi.mock('../socketClient', async (original) => ({
    ...await original<typeof import('../socketClient')>(),
    createSessionScopedSocketCollector: () => boundary.sockets.shift(),
}));
vi.mock('../http', () => ({ fetchJson: async (url: string, init?: RequestInit) => {
    if (url.endsWith('/v1/sessions')) boundary.sessionBody = JSON.parse(String(init?.body));
    return ({
    status: 200,
    data: url.includes('/v2/sessions/') ? { session: {
        id: 'seed-session', seq: 0, metadata: boundary.sessionBody?.metadata ?? '{}', metadataVersion: 0, agentState: boundary.sessionBody?.agentState ?? null, agentStateVersion: 0,
        createdAt: 1, updatedAt: 1, meaningfulActivityAt: 1, active: true, activeAt: 1,
        latestTurnStatus: null, lastRuntimeIssue: null,
    } } : url.endsWith('/v2/sessions') ? { sessions: [boundary.sessionBody] } : { session: { id: 'seed-session' }, machine: { id: 'seed-machine' }, success: true },
}); } }));

const desk = { serverBaseUrl: 'http://127.0.0.1:23456', proxyBaseUrl: '', uiBaseUrl: '', token: 'synthetic-token' };
function socket(fail: boolean) {
    const value = {
        connect: vi.fn(() => { if (fail) throw new Error('connection refused'); }),
        close: vi.fn(), isConnected: () => true, emit: vi.fn(),
    };
    // Only the socket adapter is replaced, including connection refusal before presence/start settles.
    boundary.sockets.push(value as unknown as SocketCollector);
    return value;
}
afterEach(() => { boundary.sockets.length = 0; boundary.sessionBody = null; });

test.each(['coordinator', 'worker'] as const)('%s presence failure still closes its created socket', async (kind) => {
    const presence = socket(true);
    const seed = createDeskSeeder(desk);
    try {
        const starting = kind === 'coordinator' ? seed.startCoordinator('/tmp/desk-coordinator') : seed.startWorker({ issueTag: 'ATR-301-build', title: 'Local seed' });
        await expect(starting).rejects.toThrow('connection refused');
    } finally {
        await seed.stopAll();
    }
    expect(presence.close).toHaveBeenCalledOnce();
});

test('agent startup failure closes both its agent socket and the online presence socket', async () => {
    const presence = socket(false);
    const agent = socket(true);
    const seed = createDeskSeeder(desk);
    try {
        await expect(seed.startWorker({ issueTag: 'ATR-302-build', title: 'Local seed' })).rejects.toThrow('connection refused');
    } finally {
        await seed.stopAll();
    }
    expect(presence.close).toHaveBeenCalledOnce();
    expect(agent.close).toHaveBeenCalledOnce();
});

// This is the same key derivation the real browser uses in Encryption.create.
// Secrets and encrypted bytes remain local variables, never assertion operands.
test('encrypted desk seeds wrap a distinct data key for the disposable browser and encrypt metadata', async () => {
    socket(false);
    const machineKey = deriveAccountMachineKeyFromRecoverySecret(randomBytes(32));
    const recipient = tweetnacl.box.keyPair.fromSecretKey(machineKey);
    const seed = createDeskSeeder({ ...desk, encryption: { contentPublicKey: recipient.publicKey } });
    try {
        await seed.startCoordinator('/tmp/desk-coordinator');
        const body = boundary.sessionBody!;
        expect(body.encryptionMode, 'the seed must not silently use its plain default').toBe('e2ee');
        const key = openEncryptedDataKeyEnvelopeV1({
            envelope: Buffer.from(String(body.dataEncryptionKey), 'base64'), recipientSecretKeyOrSeed: machineKey,
        });
        expect(key?.length, 'the browser can open the wrapped session key').toBe(32);
        const metadata = decryptDataKeyBase64(String(body.metadata), key!);
        expect(metadata?.path === '/tmp/desk-coordinator', 'browser key decrypts the seeded metadata').toBe(true);
        socket(false);
        await seed.startCoordinator('/tmp/desk-second-coordinator');
        const secondKey = openEncryptedDataKeyEnvelopeV1({ envelope: Buffer.from(String(boundary.sessionBody!.dataEncryptionKey), 'base64'), recipientSecretKeyOrSeed: machineKey });
        expect(secondKey?.length).toBe(32);
        expect(Buffer.from(key!).equals(Buffer.from(secondKey!)), 'each session gets a distinct data key').toBe(false);
        const stranger = deriveAccountMachineKeyFromRecoverySecret(randomBytes(32));
        expect(openEncryptedDataKeyEnvelopeV1({ envelope: Buffer.from(String(body.dataEncryptionKey), 'base64'), recipientSecretKeyOrSeed: stranger }) === null).toBe(true);
    } finally { await seed.stopAll(); }
});


test('the encrypted evidence gate rejects a real plain seed without leaking its payload', async () => {
    socket(false);
    const seed = createDeskSeeder(desk);
    try {
        await seed.startCoordinator('/tmp/desk-coordinator');
        await assertDeskStorageMode(desk, 'plain');
        await expect(assertDeskStorageMode(desk, 'e2ee')).rejects.toThrow('storage mode mismatch');
        await expect(seed.assertPersistedEncryption()).rejects.toThrow('rejected a plain session');
        // Mislabeling the same plain payload must fail too, not just a missing mode flag.
        boundary.sessionBody!.encryptionMode = 'e2ee';
        boundary.sessionBody!.dataEncryptionKey = 'synthetic-placeholder';
        await expect(assertDeskStorageMode(desk, 'e2ee')).rejects.toThrow('silently fell back to plain JSON');
    } finally { await seed.stopAll(); }
});

test.each(['current', 'legacy'] as const)('encrypted worker accepts %s serialization and rejects plaintext RPC', async (serialization) => {
    socket(false);
    let receiver: ((request: { method: string; params: unknown }) => Promise<unknown>) | undefined;
    boundary.sockets.push({
        connect() {}, close() {}, isConnected: () => true,
        onRpcRequest(handler: typeof receiver) { receiver = handler; },
        async rpcRegister() {},
        async emitWithAck(_event: string, data: { agentState: string }) {
            boundary.sessionBody!.agentState = data.agentState;
            return { result: 'success' };
        },
    });
    const machineKey = deriveAccountMachineKeyFromRecoverySecret(randomBytes(32));
    const seed = createDeskSeeder({ ...desk, encryption: { contentPublicKey: tweetnacl.box.keyPair.fromSecretKey(machineKey).publicKey } });
    try {
        const worker = await seed.startWorker({ issueTag: 'ATR-301-build', title: 'Synthetic encrypted worker' });
        const key = openEncryptedDataKeyEnvelopeV1({ envelope: Buffer.from(String(boundary.sessionBody!.dataEncryptionKey), 'base64'), recipientSecretKeyOrSeed: machineKey });
        expect(key?.length).toBe(32);
        boundary.sessionBody!.agentState = encodeBase64(encrypt(key!, 'dataKey', {
            completedRequests: { earlier: { tool: 'Bash', arguments: {}, status: 'denied' } },
        }));
        await worker.agent.publishPermissionRequest({ id: 'unit-permission', tool: 'Bash', args: { command: 'echo synthetic' } });
        const decision = { id: 'unit-permission', approved: true };
        for (const params of [decision, JSON.stringify(decision), Buffer.from(JSON.stringify({ t: 'plain', v: decision })).toString('base64'),
            encodeBase64(encrypt(randomBytes(32), 'dataKey', decision))]) {
            await receiver!({ method: `${worker.sessionId}:permission`, params });
        }
        expect(worker.agent.getReceivedDecisions(), 'plain fallback must not reach the receiver').toEqual([]);
        expect(worker.readPermissionRpcEvidence(), 'rejected inputs are not accepted-RPC evidence').toEqual([]);
        expect(await worker.readPermissionState()).toEqual({ pending: ['unit-permission'], completed: { earlier: 'denied' } });
        // Use the real CLI serializer/cipher, also used by the UI. A testkit-only
        // round trip misses the current serialized JSON envelope inside AES-GCM.
        const params = serialization === 'current'
            ? encodeBase64(encrypt(key!, 'dataKey', decision))
            : encryptDataKeyBase64(decision, key!);
        const answer = await receiver!({ method: `${worker.sessionId}:permission`, params });
        expect(worker.agent.getReceivedDecisions()).toEqual([decision]);
        expect(worker.readPermissionRpcEvidence()).toEqual([
            { sessionId: worker.sessionId, permissionId: decision.id, encrypted: true, matchesDecision: true },
        ]);
        expect(typeof answer === 'string' && decryptDataKeyBase64(answer, key!)?.ok === true).toBe(true);
        expect(await worker.readPermissionState()).toEqual({ pending: [], completed: { earlier: 'denied', 'unit-permission': 'approved' } });
        await assertDeskStorageMode(desk, 'e2ee');
        await seed.assertPersistedEncryption();
    } finally { await seed.stopAll(); }
});

test('plain worker evidence comes from the accepted raw RPC and matches its completed state', async () => {
    socket(false);
    let receiver: ((request: { method: string; params: unknown }) => Promise<unknown>) | undefined;
    boundary.sockets.push({
        connect() {}, close() {}, isConnected: () => true,
        onRpcRequest(handler: typeof receiver) { receiver = handler; },
        async rpcRegister() {},
        async emitWithAck(_event: string, data: { agentState: string }) {
            boundary.sessionBody!.agentState = data.agentState;
            return { result: 'success' };
        },
    });
    const seed = createDeskSeeder(desk);
    try {
        const worker = await seed.startWorker({ issueTag: 'ATR-301-build', title: 'Synthetic plain worker' });
        await worker.agent.publishPermissionRequest({ id: 'unit-permission', tool: 'Bash', args: { command: 'echo synthetic' } });
        const decision = { id: 'unit-permission', approved: true };
        await receiver!({ method: 'another-session:permission', params: decision });
        expect(worker.readPermissionRpcEvidence()).toEqual([]);
        await receiver!({ method: `${worker.sessionId}:permission`, params: decision });
        expect(worker.agent.getReceivedDecisions()).toEqual([decision]);
        expect(worker.readPermissionRpcEvidence()).toEqual([
            { sessionId: worker.sessionId, permissionId: decision.id, encrypted: false, matchesDecision: true },
        ]);
        expect(await worker.readPermissionState()).toEqual({ pending: [], completed: { 'unit-permission': 'approved' } });
    } finally { await seed.stopAll(); }
});
