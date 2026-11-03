import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { storage } from '@/sync/domains/state/storage';
import { createSessionFixture } from '@/dev/testkit/fixtures/sessionFixtures';
import type { AgentState } from '@/sync/domains/state/storageTypes';
import { listPendingSessionRequests, observePendingSessionRequest } from '@/sync/domains/session/pending/listPendingSessionRequests';
import { createVoiceToolHandlers } from './handlers';

const boundary = vi.hoisted(() => ({
  rpc: vi.fn(async (_args: unknown) => ({ ok: true })),
  ensureVisible: vi.fn(async () => {}),
  refreshMessages: vi.fn(async () => {}),
}));
// Keep the store, request owners, handler and executor real. Only transport,
// remote hydration and analytics leave this process.
vi.mock('@/sync/runtime/orchestration/serverScopedRpc/serverScopedSessionRpc', () => ({
  sessionRpcWithServerScope: boundary.rpc,
}));
vi.mock('@/sync/sync', () => ({ sync: {
  ensureSessionVisibleForMessageRoute: boundary.ensureVisible,
  refreshSessionMessages: boundary.refreshMessages,
} }));
vi.mock('@/track', () => ({ trackPermissionResponse: vi.fn() }));
vi.mock('@/sync/domains/server/serverRuntime', () => ({
  getActiveServerSnapshot: () => ({ serverId: 'test-server', serverUrl: 'https://server.invalid', generation: 1 }),
}));

type Kind = 'permission' | 'user_action';
type Evidence = 'producer' | 'transcript';
const kinds = ['permission', 'user_action'] as const;
const evidenceKinds = ['producer', 'transcript'] as const;
let previous: ReturnType<typeof storage.getState>;
beforeEach(() => {
  previous = storage.getState();
  storage.setState({ sessions: {}, sessionMessages: {}, sessionListRenderables: {} });
  vi.clearAllMocks();
});
afterEach(() => { storage.setState(previous, true); vi.restoreAllMocks(); });

function request(kind: Kind, id = 'r', createdAt = 100) {
  return { tool: kind === 'permission' ? 'Bash' : 'AskUserQuestion', kind, createdAt,
    arguments: kind === 'permission' ? { command: `echo ${id}` } : { questions: [{ question: id, options: [] }] } };
}
function publish(sessionId: string, agentState: AgentState, active = true) {
  const current = storage.getState().sessions[sessionId];
  storage.getState().applySessions([createSessionFixture({ ...current, id: sessionId, active,
    agentStateVersion: (current?.agentStateVersion ?? 0) + 1, agentState })]);
}
function complete(kind: Kind, evidence: Evidence) {
  const r = request(kind);
  const completedRequests = { r: { ...r, completedAt: 200, status: 'approved' as const } };
  publish('current', { requests: { r }, completedRequests });
  if (evidence === 'transcript') {
    storage.getState().applyMessages('current', [{ id: 'call-r', localId: null, createdAt: 100,
      role: 'agent', isSidechain: false, content: [{ type: 'tool-call', id: 'r', name: r.tool,
        input: r.arguments, description: null, uuid: 'call-r', parentUUID: null }] }]);
    const session = storage.getState().sessions.current;
    // The transcript has already observed completion. A later producer snapshot
    // still advertises r but no longer carries its completion record.
    storage.setState({ sessions: { ...storage.getState().sessions,
      current: { ...session, agentState: { requests: { r }, completedRequests: {} } } } });
    const entry = storage.getState().sessionMessages.current;
    expect(entry.renderableAggregate?.requestStates.get('r')).toMatchObject({ status: 'terminal' });
    expect(entry.messageIdsOldestFirst.length).toBeGreaterThan(0);
    expect('messages' in entry).toBe(false);
  } else {
    expect(storage.getState().sessionMessages.current).toBeUndefined();
  }
  const state = storage.getState();
  expect(Object.keys(state.sessions.current.agentState!.requests!)).toEqual(['r']);
  const states = state.sessionMessages.current?.renderableAggregate?.requestStates;
  expect(listPendingSessionRequests(state.sessions.current, undefined, states ? { states } : undefined)).toEqual([]);
  expect(observePendingSessionRequest(state.sessions.current, 'r', states?.get('r')).status).toBe('terminal');
}
function tools() {
  return createVoiceToolHandlers({ resolveSessionId: explicit => explicit || 'current' });
}
function inspectOnly(kind: Kind) {
  const r = request(kind);
  publish('current', { requests: { r } });
  storage.getState().applyMessages('current', [{ id: 'pending-r', localId: null, createdAt: 100,
    role: 'agent', isSidechain: false, content: [{ type: 'tool-call', id: 'r', name: r.tool,
      input: r.arguments, description: null,
      uuid: 'pending-r', parentUUID: null }] }]);
  const current = storage.getState().sessions.current;
  storage.setState({ sessions: { ...storage.getState().sessions, current: { ...current, agentState: {
    requests: {}, completedRequests: {
      r: { ...request(kind, 'different', 500), completedAt: 600, status: 'approved' },
    },
  } } } });
  const state = storage.getState();
  expect(listPendingSessionRequests(state.sessions.current, undefined, {
    states: state.sessionMessages.current.renderableAggregate!.requestStates,
  })).toMatchObject([{ id: 'r', requiresInspection: true }]);
}
async function act(kind: Kind, params: Record<string, unknown> = {}) {
  const handlers = tools();
  return JSON.parse(await (kind === 'permission'
    ? handlers.processPermissionRequest({ decision: 'allow', ...params })
    : handlers.answerUserActionRequest({
      ...(params.decision === undefined && params.answers === undefined
        ? { answers: [{ question: 'r', answer: 'yes' }] } : {}),
      ...params,
    })));
}
function expectNoTransport() {
  // Vitest's RED output retains the actual method/session/payload attempted.
  expect(boundary.rpc.mock.calls).toEqual([]);
}

describe.each(evidenceKinds)('Voice real store: %s completion', evidence => {
  it.each(kinds)('never sends the sole raw completed %s request', async kind => {
    complete(kind, evidence);
    const attempts = kind === 'permission'
      ? [{ decision: 'allow' }, { decision: 'deny' }]
      : [{ decision: 'approve' }, { decision: 'reject' }, { answers: [{ question: 'r', answer: 'yes' }] }];
    for (const parameters of attempts) {
      for (const requestId of ['r', undefined]) {
        const result = await act(kind, { ...parameters, requestId });
        expectNoTransport();
        expect(result.ok).toBe(false);
      }
    }
  });

  it.each(kinds)('does not redirect an unqualified %s action to another session', async kind => {
    complete(kind, evidence);
    publish('other', { requests: { q: request(kind, 'q') } });
    const result = await act(kind);
    expectNoTransport();
    expect(result.ok).toBe(false);
    expect(await act(kind, { sessionId: 'other', requestId: 'q' })).toMatchObject({ ok: true, sessionId: 'other', requestId: 'q' });
    expect(boundary.rpc).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'other', payload: expect.objectContaining({ id: 'q' }) }));
  });

  it.each(kinds)('keeps independent q and a newer reopened %s r usable', async kind => {
    complete(kind, evidence);
    const current = storage.getState().sessions.current;
    storage.setState({ sessions: { current: { ...current, agentState: { ...current.agentState,
      requests: { ...current.agentState?.requests, q: request(kind, 'q', 300) } } } } });
    expect(await act(kind)).toMatchObject({ ok: true, requestId: 'q' });
    expect(boundary.rpc).toHaveBeenCalledWith(expect.objectContaining({ payload: expect.objectContaining({ id: 'q' }) }));
    boundary.rpc.mockClear();
    const state = storage.getState();
    storage.setState({ sessions: { current: { ...state.sessions.current, agentState: {
      ...state.sessions.current.agentState, requests: { r: request(kind, 'r', 400) } } } } });
    expect(await act(kind, { requestId: 'r' })).toMatchObject({ ok: true, requestId: 'r' });
    expect(boundary.rpc).toHaveBeenCalledWith(expect.objectContaining({ payload: expect.objectContaining({ id: 'r' }) }));
  });

  it.each(kinds)('rechecks %s completion that arrives after selection', async kind => {
    publish('current', { requests: { r: request(kind) } });
    const pending = act(kind, { requestId: 'r' });
    complete(kind, evidence);
    const result = await pending;
    expectNoTransport();
    expect(result).toMatchObject({ ok: false, errorCode: 'permission_request_changed' });
  });
});

it.each(kinds)('keeps empty-session fallback and active-session boundaries for %s', async kind => {
  publish('current', { requests: {} });
  publish('other', { requests: { q: request(kind, 'q') } });
  expect(await act(kind, { sessionId: 'current' })).toMatchObject({ ok: false });
  expect(await act(kind, { currentSessionOnly: true })).toMatchObject({ ok: false, errorCode: 'request_not_in_current_session' });
  expectNoTransport();
  expect(await act(kind)).toMatchObject({ ok: true, sessionId: 'other', requestId: 'q' });
  boundary.rpc.mockClear();
  publish('other', { requests: { q: request(kind, 'q') } }, false);
  expect(await act(kind, { sessionId: 'other', requestId: 'q' })).toMatchObject({ ok: false });
  expect(await act(kind)).toMatchObject({ ok: false });
  expectNoTransport();
});

it.each(kinds)('uses the maintained transcript index without historical reads for %s', async kind => {
  complete(kind, 'transcript');
  const entry = storage.getState().sessionMessages.current;
  let historicalReads = 0;
  const messagesById = new Proxy(entry.messagesById, { get(target, key, receiver) {
    historicalReads++;
    return Reflect.get(target, key, receiver);
  } });
  storage.setState({ sessionMessages: { current: { ...entry, messagesById } } });
  const result = await act(kind, { requestId: 'r' });
  expectNoTransport();
  expect(result.ok).toBe(false);
  const current = storage.getState().sessions.current;
  storage.setState({ sessions: { current: { ...current, agentState: { ...current.agentState,
    requests: { ...current.agentState?.requests, q: request(kind, 'q', 300) },
  } } } });
  expect(await act(kind, { requestId: 'q' })).toMatchObject({ ok: true, requestId: 'q' });
  expect(boundary.rpc).toHaveBeenCalledWith(expect.objectContaining({ payload: expect.objectContaining({ id: 'q' }) }));
  expect(historicalReads).toBe(0);
});

it.each(kinds)('uses canonical normalized transcript evidence when the %s index is unavailable', async kind => {
  complete(kind, 'transcript');
  const entry = storage.getState().sessionMessages.current;
  storage.setState({ sessionMessages: { current: { ...entry, renderableAggregate: undefined } } });
  expect(await act(kind, { requestId: 'r' })).toMatchObject({ ok: false });
  expectNoTransport();
});

it.each(kinds)('keeps indexed inspect-only %s in the current session', async kind => {
  inspectOnly(kind);
  publish('other', { requests: { q: request(kind, 'q', 300) } });
  for (const requestId of ['r', undefined]) {
    expect(await act(kind, { requestId })).toMatchObject({ ok: false, errorCode: 'permission_request_requires_inspection' });
  }
  expectNoTransport();
});

it.each(kinds)('blocks late inspect-only evidence for %s', async kind => {
  publish('current', { requests: { r: request(kind) } });
  const pending = act(kind, { requestId: 'r' });
  inspectOnly(kind);
  expect(await pending).toMatchObject({ ok: false, errorCode: 'permission_request_changed' });
  expectNoTransport();
});

it.each(kinds)('does not use a completed item of the other kind as empty-session authority: %s', async kind => {
  complete(kind === 'permission' ? 'user_action' : 'permission', 'producer');
  publish('other', { requests: { q: request(kind, 'q') } });
  expect(await act(kind)).toMatchObject({ ok: false });
  expectNoTransport();
});

it.each(kinds)('does not fall back after %s hydration fails', async kind => {
  publish('current', { requests: {} });
  publish('other', { requests: { q: request(kind, 'q') } });
  boundary.refreshMessages.mockRejectedValueOnce(new Error('refresh unavailable'));
  expect(await act(kind)).toMatchObject({ ok: false, errorCode: 'permission_request_unavailable' });
  expectNoTransport();
});

it.each(kinds)('blocks a late inactive boundary for %s', async kind => {
  publish('current', { requests: { r: request(kind) } });
  const pending = act(kind, { requestId: 'r' });
  publish('current', { requests: { r: request(kind) } }, false);
  expect(await pending).toMatchObject({ ok: false });
  expectNoTransport();
});

it.each(kinds)('fails closed on %s evidence read errors at selection and dispatch', async kind => {
  complete(kind, 'transcript');
  const entry = storage.getState().sessionMessages.current;
  const unreadable = { ...entry, get renderableAggregate(): typeof entry.renderableAggregate {
    throw new Error('unreadable request evidence');
  } };
  publish('other', { requests: { q: request(kind, 'q') } });
  storage.setState({ sessionMessages: { current: unreadable } });
  expect(await act(kind)).toMatchObject({ ok: false, errorCode: 'permission_request_unavailable' });
  expectNoTransport();
  storage.setState({ sessionMessages: {} });
  publish('current', { requests: { r: request(kind, 'r', 400) } });
  const pending = act(kind, { requestId: 'r' });
  storage.setState({ sessionMessages: { current: unreadable } });
  expect(await pending).toMatchObject({ ok: false, errorCode: 'permission_request_unavailable' });
  expectNoTransport();
});
