import { randomBytes, randomUUID } from 'node:crypto';

import { sealEncryptedDataKeyEnvelopeV1 } from '@happier-dev/protocol';
import { isDeepStrictEqual } from 'node:util';
import { decryptDataKeyBase64, encryptDataKeyBase64 } from '../rpcCrypto';
import { fetchJson } from '../http';
import { fetchSessionV2 } from '../sessions';
import { createMachineBoundSessionScopedSocketCollector } from '../sessionSocketBinding';
import type { SocketCollector } from '../socketClient';
import { SyntheticAgent } from '../syntheticAgent/syntheticAgent';
import { waitFor } from '../timing';
import type { DeskAccount } from './deskTest';
import { createDeskPermissionProof, type DeskPermissionEvidence } from './deskPermissionProof';

/**
 * Seeds desk sessions through the doors Happier uses (REST and the session socket), never the store.
 * `startDeskWorker` returns a running worker; `stopAll` closes every socket opened for the test.
 */
export type DeskWorker = Readonly<{
    sessionId: string;
    agent: SyntheticAgent;
    readPermissionState: () => Promise<{ pending: string[]; completed: Record<string, string> }>;
    readPermissionRpcEvidence: () => readonly DeskPermissionEvidence[];
    setWorking: () => Promise<void>;
    setIdle: () => Promise<void>;
}>;

async function createDeskSession(desk: DeskAccount, metadata: Readonly<Record<string, unknown>>) {
    const value = { v: 1, flavor: 'claude', ...metadata };
    const dataKey = desk.encryption ? randomBytes(32) : null;
    const wrappedKey = dataKey && desk.encryption ? sealEncryptedDataKeyEnvelopeV1({
        dataKey, recipientPublicKey: desk.encryption.contentPublicKey, randomBytes,
    }) : null;
    const res = await fetchJson<{ session?: { id?: unknown } }>(`${desk.serverBaseUrl}/v1/sessions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${desk.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            tag: `desk-${randomUUID()}`,
            metadata: dataKey ? encryptDataKeyBase64(value, dataKey) : JSON.stringify(value),
            agentState: dataKey ? encryptDataKeyBase64({}, dataKey) : null,
            dataEncryptionKey: wrappedKey ? Buffer.from(wrappedKey).toString('base64') : null,
            encryptionMode: dataKey ? 'e2ee' : 'plain',
        }),
        timeoutMs: 20_000,
    });
    const id = res.data?.session?.id;
    if (res.status !== 200 || typeof id !== 'string') throw new Error(`Could not seed a session (status ${res.status})`);
    return { sessionId: id, dataKey, metadata: value };
}

async function postTurn(desk: DeskAccount, sessionId: string, turnId: string, action: 'begin' | 'complete'): Promise<void> {
    const res = await fetchJson<{ success?: unknown; reason?: unknown }>(`${desk.serverBaseUrl}/v1/sessions/${sessionId}/turns/mutations`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${desk.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            v: 1,
            action,
            sessionId,
            turnId,
            mutationId: `mutation-${randomUUID()}`,
            observedAt: Date.now(),
            provider: 'claude',
        }),
        timeoutMs: 20_000,
    });
    if (res.status !== 200 || res.data?.success !== true) {
        throw new Error(`Turn ${action} refused (status ${res.status}, reason ${String(res.data?.reason)})`);
    }
}

async function goOnline(desk: DeskAccount, sessionId: string, register: (close: () => void) => void): Promise<SocketCollector> {
    const { socket } = await createMachineBoundSessionScopedSocketCollector({ baseUrl: desk.serverBaseUrl, token: desk.token, sessionId });
    register(() => socket.close());
    socket.connect();
    await waitFor(async () => socket.isConnected(), { timeoutMs: 20_000, context: `presence socket for ${sessionId}` });
    socket.emit('session-alive', { sid: sessionId, time: Date.now(), thinking: false });
    await waitFor(async () => (await fetchSessionV2(desk.serverBaseUrl, desk.token, sessionId)).active === true, {
        timeoutMs: 20_000,
        context: `presence of ${sessionId}`,
    });
    return socket;
}

export function createDeskSeeder(desk: DeskAccount) {
    const closers: (() => Promise<void> | void)[] = [];
    const register = (close: () => Promise<void> | void) => { closers.push(close); };

    const sessions: Awaited<ReturnType<typeof createDeskSession>>[] = [];
    const create = async (metadata: Readonly<Record<string, unknown>>) => {
        const session = await createDeskSession(desk, metadata);
        sessions.push(session);
        return session;
    };

    return {
        /** Prove GET round trips through real storage and the matching session cipher. */
        async assertPersistedEncryption(): Promise<void> {
            for (const session of sessions) {
                if (!session.dataKey) throw new Error('Encrypted proof rejected a plain session');
                const row = await fetchSessionV2(desk.serverBaseUrl, desk.token, session.sessionId);
                if (!isDeepStrictEqual(decryptDataKeyBase64(row.metadata, session.dataKey), session.metadata)) {
                    throw new Error('Persisted metadata did not decrypt to the seeded metadata');
                }
                const state = row.agentState && decryptDataKeyBase64(row.agentState, session.dataKey);
                if (!state || typeof state !== 'object') throw new Error('Persisted agent state did not decrypt');
            }
        },
        async startCoordinator(path: string): Promise<string> {
            const { sessionId } = await create({ name: 'Coordinator chat', path });
            await goOnline(desk, sessionId, register);
            return sessionId;
        },

        /** A live worker under `issueTag` (`ATR-1-build`), with a title that names no issue, idle until told otherwise. */
        async startWorker(params: Readonly<{ issueTag: string; title: string }>): Promise<DeskWorker> {
            const { sessionId, dataKey } = await create({
                name: params.title,
                path: `/tmp/desk-e2e-workers/${randomUUID()}`,
                tag: params.issueTag,
            });
            const socket = await goOnline(desk, sessionId, register);
            const proof = createDeskPermissionProof(sessionId, dataKey);
            const agent = new SyntheticAgent({ baseUrl: desk.serverBaseUrl, token: desk.token, sessionId, encryption: dataKey ? { type: 'dataKey', dataKey } : { type: 'plain' }, onPermissionDecision: proof.observe });
            register(() => agent.stop());
            await agent.start();
            let turnId: string | null = null;
            return {
                sessionId,
                agent,
                async readPermissionState() {
                    const row = await fetchSessionV2(desk.serverBaseUrl, desk.token, sessionId);
                    const state = row.agentState ? (dataKey ? decryptDataKeyBase64(row.agentState, dataKey) : JSON.parse(row.agentState)) : {};
                    if (!state || typeof state !== 'object') throw new Error('Worker state could not be decoded');
                    const value = state as { requests?: Record<string, unknown>; completedRequests?: Record<string, { status: string }> };
                    return {
                        pending: Object.keys(value.requests ?? {}).sort(),
                        completed: Object.fromEntries(Object.entries(value.completedRequests ?? {}).map(([id, request]) => [id, request.status])),
                    };
                },
                readPermissionRpcEvidence: proof.read,
                async setWorking() {
                    turnId = `turn-${randomUUID()}`;
                    await postTurn(desk, sessionId, turnId, 'begin');
                    socket.emit('session-alive', { sid: sessionId, time: Date.now(), thinking: true });
                },
                async setIdle() {
                    turnId ??= `turn-${randomUUID()}`;
                    await postTurn(desk, sessionId, turnId, 'begin');
                    await postTurn(desk, sessionId, turnId, 'complete');
                    socket.emit('session-alive', { sid: sessionId, time: Date.now(), thinking: false });
                },
            };
        },

        async stopAll(): Promise<void> {
            for (const close of closers.splice(0)) await close();
        },
    };
}
