import { randomUUID } from 'node:crypto';

import { fetchJson } from '../http';
import { fetchSessionV2 } from '../sessions';
import { createMachineBoundSessionScopedSocketCollector } from '../sessionSocketBinding';
import type { SocketCollector } from '../socketClient';
import { SyntheticAgent } from '../syntheticAgent/syntheticAgent';
import { waitFor } from '../timing';
import type { DeskAccount } from './deskTest';

/**
 * Seeds desk sessions through the doors Happier uses (REST and the session socket), never the store.
 * `startDeskWorker` returns a running worker; `stopAll` closes every socket opened for the test.
 */
export type DeskWorker = Readonly<{
    sessionId: string;
    agent: SyntheticAgent;
    setWorking: () => Promise<void>;
    setIdle: () => Promise<void>;
}>;

async function createPlainSession(desk: DeskAccount, metadata: Readonly<Record<string, unknown>>): Promise<string> {
    const res = await fetchJson<{ session?: { id?: unknown } }>(`${desk.serverBaseUrl}/v1/sessions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${desk.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            tag: `desk-${randomUUID()}`,
            metadata: JSON.stringify({ v: 1, flavor: 'claude', ...metadata }),
            agentState: null,
            dataEncryptionKey: null,
            encryptionMode: 'plain',
        }),
        timeoutMs: 20_000,
    });
    const id = res.data?.session?.id;
    if (res.status !== 200 || typeof id !== 'string') throw new Error(`Could not seed a session (status ${res.status})`);
    return id;
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

    return {
        async startCoordinator(path: string, machineId?: string): Promise<string> {
            const sessionId = await createPlainSession(desk, { name: 'Coordinator chat', path, ...(machineId ? { machineId } : {}) });
            await goOnline(desk, sessionId, register);
            return sessionId;
        },

        /** A live worker under `issueTag` (`ATR-1-build`), with a title that names no issue, idle until told otherwise. */
        async startWorker(params: Readonly<{ issueTag: string; title: string }>): Promise<DeskWorker> {
            const sessionId = await createPlainSession(desk, {
                name: params.title,
                path: `/tmp/desk-e2e-workers/${randomUUID()}`,
                tag: params.issueTag,
            });
            const socket = await goOnline(desk, sessionId, register);
            const agent = new SyntheticAgent({ baseUrl: desk.serverBaseUrl, token: desk.token, sessionId, encryption: { type: 'plain' } });
            register(() => agent.stop());
            await agent.start();
            let turnId: string | null = null;
            return {
                sessionId,
                agent,
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
