import { afterEach, expect, test, vi } from 'vitest';
import type { SocketCollector } from '../socketClient';
import { createDeskSeeder } from './deskSeed';

const boundary = vi.hoisted(() => ({ sockets: [] as unknown[], bodies: [] as string[] }));
// HTTP and socket collectors are network boundaries; session parsing and SyntheticAgent run real.
vi.mock('../socketClient', async (original) => ({
    ...await original<typeof import('../socketClient')>(),
    createSessionScopedSocketCollector: () => boundary.sockets.shift(),
}));
vi.mock('../http', () => ({ fetchJson: async (url: string, init?: { body?: string }) => { if (url.endsWith('/v1/sessions') && init?.body) boundary.bodies.push(init.body); return ({
    status: 200,
    data: url.includes('/v2/sessions/') ? { session: {
        id: 'seed-session', seq: 0, metadata: '{}', metadataVersion: 0, agentState: null, agentStateVersion: 0,
        createdAt: 1, updatedAt: 1, meaningfulActivityAt: 1, active: true, activeAt: 1,
        latestTurnStatus: null, lastRuntimeIssue: null,
    } } : { session: { id: 'seed-session' }, machine: { id: 'seed-machine' }, success: true },
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
afterEach(() => { boundary.sockets.length = 0; boundary.bodies.length = 0; });

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

test('coordinator metadata carries its machine only when supplied', async () => {
    socket(false); socket(false);
    const seed = createDeskSeeder(desk);
    try {
        await seed.startCoordinator('/tmp/desk', 'machine-id');
        await seed.startCoordinator('/tmp/desk');
        const metadata = boundary.bodies.map(body => JSON.parse(JSON.parse(body).metadata));
        expect(metadata[0].machineId).toBe('machine-id');
        expect(metadata[1]).not.toHaveProperty('machineId');
    } finally { await seed.stopAll(); }
});
