import { randomUUID } from 'node:crypto';
import { encodePlainMachineStoredContent, MACHINE_PLAIN_DATA_KEY_MARKER } from '@happier-dev/protocol';
import { RPC_METHODS } from '@happier-dev/protocol/rpc';
import { createEncryptedTransferChunkEnvelope, parseTransferRecipientPublicKeyBase64 } from '@/machines/transfer/transferChunkEncryption';
import { fetchJson } from '../http';
import { createMachineScopedSocketCollector, createSessionScopedSocketCollector } from '../socketClient';
import { waitFor } from '../timing';

/** Read-only RPC boundary fixture. Only explicitly supplied synthetic files exist. */
export function createJ4FileResponder(files: ReadonlyMap<string, Buffer>) {
    const downloads = new Map<string, { bytes: Buffer; key: string; nextIndex: number }>();
    const handle = (method: string, params: unknown) => {
        const data = params && typeof params === 'object' ? params as Record<string, unknown> : {};
        const bytes = typeof data.path === 'string' ? files.get(data.path) : undefined;
        if (method === RPC_METHODS.STAT_FILE) {
            return bytes ? { success: true, exists: true, kind: 'file', sizeBytes: bytes.length, modifiedMs: 0 } : { success: true, exists: false };
        }
        if (method === RPC_METHODS.DAEMON_BULK_TRANSFER_DOWNLOAD_INIT) {
            if (data.t !== 'session_file_download_v1' || data.asZip || !bytes || typeof data.recipientPublicKeyBase64 !== 'string') return { success: false, error: 'Invalid request' };
            try { parseTransferRecipientPublicKeyBase64(data.recipientPublicKeyBase64); } catch { return { success: false, error: 'Invalid transfer recipient public key' }; }
            const downloadId = randomUUID();
            downloads.set(downloadId, { bytes, key: data.recipientPublicKeyBase64, nextIndex: 0 });
            return { success: true, downloadId, chunkSizeBytes: bytes.length, sizeBytes: bytes.length, name: String(data.path).split('/').pop() };
        }
        const id = typeof data.downloadId === 'string' ? data.downloadId : '';
        if (method === RPC_METHODS.DAEMON_BULK_TRANSFER_DOWNLOAD_FINALIZE || method === RPC_METHODS.DAEMON_BULK_TRANSFER_DOWNLOAD_ABORT) {
            downloads.delete(id);
            return { success: true };
        }
        if (method === RPC_METHODS.DAEMON_BULK_TRANSFER_DOWNLOAD_CHUNK) {
            const download = downloads.get(id);
            if (!download) return { success: false, error: 'Download session not found' };
            if (data.index !== download.nextIndex) return { success: false, error: 'Unexpected chunk index' };
            download.nextIndex++;
            return { success: true, ...createEncryptedTransferChunkEnvelope({ transferId: id, sequence: 0, payload: download.bytes, recipientPublicKeyBase64: download.key }), isLast: true };
        }
        return { success: false, error: 'method-not-found' };
    };
    return { handle, close: () => downloads.clear() };
}

/** J4 models the daemon's machine filesystem owner and session transfer owner. */
export async function registerJ4Machine(params: { baseUrl: string; token: string; machineId: string; sessionId: string; handle: (method: string, params: unknown, owner: 'machine' | 'session') => unknown }) {
    const headers = { Authorization: `Bearer ${params.token}`, 'Content-Type': 'application/json' };
    const machineResult = await fetchJson(`${params.baseUrl}/v1/machines`, { method: 'POST', headers, timeoutMs: 20_000, body: JSON.stringify({
        id: params.machineId, dataEncryptionKey: MACHINE_PLAIN_DATA_KEY_MARKER,
        metadata: encodePlainMachineStoredContent({ host: 'desk-fixture', platform: 'linux', happyCliVersion: '0.0.0', happyHomeDir: '/tmp/desk', homeDir: '/tmp' }),
    }) });
    if (machineResult.status !== 200) throw new Error(`J4 machine registration failed (${machineResult.status})`);
    const keyResult = await fetchJson(`${params.baseUrl}/v1/access-keys/${encodeURIComponent(params.sessionId)}/${encodeURIComponent(params.machineId)}`, {
        method: 'POST', headers, timeoutMs: 20_000, body: JSON.stringify({ data: `session-socket-binding:${randomUUID()}` }),
    });
    if (keyResult.status !== 200 && keyResult.status !== 409) throw new Error(`J4 session binding failed (${keyResult.status})`);
    const machine = createMachineScopedSocketCollector(params.baseUrl, params.token, params.machineId);
    const session = createSessionScopedSocketCollector(params.baseUrl, params.token, params.sessionId, params.machineId);
    let timer: ReturnType<typeof setInterval> | undefined;
    const close = () => { if (timer) clearInterval(timer); machine.close(); session.close(); };
    try {
        machine.connect(); session.connect();
        await waitFor(() => machine.isConnected() && session.isConnected(), { timeoutMs: 20_000 });
        const alive = () => machine.emit('machine-alive', { machineId: params.machineId, time: Date.now() });
        alive();
        timer = setInterval(alive, 20_000);
        await waitFor(async () => {
            const result = await fetchJson<{ machine?: { active?: boolean } }>(`${params.baseUrl}/v1/machines/${encodeURIComponent(params.machineId)}`, { headers, timeoutMs: 5_000 });
            return result.status === 200 && result.data?.machine?.active === true;
        }, { timeoutMs: 20_000, context: 'J4 machine presence' });
        machine.onRpcRequest(({ method, params: data }) => params.handle(method.slice(params.machineId.length + 1), data, 'machine'));
        session.onRpcRequest(({ method, params: data }) => params.handle(method.slice(params.sessionId.length + 1), data, 'session'));
        const transfer = [RPC_METHODS.DAEMON_BULK_TRANSFER_DOWNLOAD_INIT, RPC_METHODS.DAEMON_BULK_TRANSFER_DOWNLOAD_CHUNK, RPC_METHODS.DAEMON_BULK_TRANSFER_DOWNLOAD_FINALIZE, RPC_METHODS.DAEMON_BULK_TRANSFER_DOWNLOAD_ABORT];
        for (const method of [RPC_METHODS.STAT_FILE, ...transfer]) await machine.rpcRegister(`${params.machineId}:${method}`);
        for (const method of transfer) await session.rpcRegister(`${params.sessionId}:${method}`);
        return { close };
    } catch (error) { close(); throw error; }
}
