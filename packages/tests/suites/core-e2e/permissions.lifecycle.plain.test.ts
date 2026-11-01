import { afterAll, describe, expect, it } from 'vitest';

import { createRunDirs } from '../../src/testkit/runDir';
import { startServerLight, type StartedServer } from '../../src/testkit/process/serverLight';
import { createTestAuth } from '../../src/testkit/auth';
import { fetchJson } from '../../src/testkit/http';
import { fetchSessionV2 } from '../../src/testkit/sessions';
import { waitFor } from '../../src/testkit/timing';
import { createUserScopedSocketCollector } from '../../src/testkit/socketClient';
import { createRpcClient } from '../../src/testkit/syntheticAgent/rpcClient';
import { SyntheticAgent } from '../../src/testkit/syntheticAgent/syntheticAgent';

const run = createRunDirs({ runLabel: 'core' });

type PlainAgentState = {
  requests?: Record<string, { tool: string; arguments: unknown }>;
  completedRequests?: Record<string, { status: string; decision?: string | null; reason?: string | null }>;
};

function readPlainAgentState(value: string | null): PlainAgentState {
  // Plain sessions store agentState as JSON text; the UI parses it the same way (parsePlainSessionAgentState).
  expect(value).not.toBeNull();
  return JSON.parse(value as string) as PlainAgentState;
}

describe('core e2e: permission lifecycle (plain session, plaintext rpc + agentState)', () => {
  let server: StartedServer | null = null;

  afterAll(async () => {
    await server?.stop();
  });

  it('agent publishes plain requests; UI allows one and denies another via plain RPC', async () => {
    const testDir = run.testDir('permission-lifecycle-plain');
    server = await startServerLight({
      testDir,
      extraEnv: {
        HAPPIER_FEATURE_ENCRYPTION__STORAGE_POLICY: 'optional',
        HAPPIER_FEATURE_ENCRYPTION__DEFAULT_ACCOUNT_MODE: 'plain',
        HAPPIER_FEATURE_ENCRYPTION__ALLOW_ACCOUNT_OPTOUT: '1',
      },
    });
    const baseUrl = server.baseUrl;
    const auth = await createTestAuth(baseUrl);
    const headers = { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json' };

    // 1. Create a plain session (same body as the ui-e2e template's createPlainSession).
    const created = await fetchJson<any>(`${baseUrl}/v1/sessions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        tag: 'plain-agent-worker-1',
        metadata: JSON.stringify({ v: 1, name: 'Plain worker', path: '/tmp/plain-agent-worker-1', flavor: 'claude' }),
        agentState: null,
        dataEncryptionKey: null,
        encryptionMode: 'plain',
      }),
      timeoutMs: 20_000,
    });
    expect(created.status).toBe(200);
    expect(created.data?.session?.encryptionMode).toBe('plain');
    const sessionId: string = created.data.session.id;

    // 2. Post a plain message.
    const posted = await fetchJson<any>(`${baseUrl}/v2/sessions/${sessionId}/messages`, {
      method: 'POST',
      headers: { ...headers, 'Idempotency-Key': 'plain-agent-msg-1' },
      body: JSON.stringify({
        localId: 'plain-agent-msg-1',
        content: { t: 'plain', v: { role: 'user', content: { type: 'text', text: 'Run the build' } } },
      }),
      timeoutMs: 20_000,
    });
    expect(posted.status).toBe(200);
    expect(posted.data?.didWrite).toBe(true);

    const agent = new SyntheticAgent({ baseUrl, token: auth.token, sessionId, encryption: { type: 'plain' } });
    const ui = createUserScopedSocketCollector(baseUrl, auth.token);
    try {
      ui.connect();
      await agent.start();
      await waitFor(() => ui.isConnected(), { timeoutMs: 20_000 });
      const uiRpc = createRpcClient(ui, { type: 'plain' });

      // 3. Raise a permission request; the server stores it as readable JSON.
      await agent.publishPermissionRequest({ id: 'perm-allow', tool: 'Bash', args: { command: 'echo hello' } });
      const pendingSession = await fetchSessionV2(baseUrl, auth.token, sessionId);
      expect(readPlainAgentState(pendingSession.agentState).requests?.['perm-allow']?.tool).toBe('Bash');
      // The server's own count drives list attention and badges; the CLI reports it with each agentState write.
      expect(pendingSession.pendingPermissionRequestCount).toBe(1);

      // 4. Allow it (the payload the UI's sessionAllow sends).
      const allowRes = await uiRpc.call(`${sessionId}:permission`, { id: 'perm-allow', approved: true, mode: 'default' });
      expect(allowRes).toEqual({ ok: true, result: { ok: true } });
      await agent.waitForCompletedPermission('perm-allow');

      // 5. Raise a second request and deny it (sessionDeny payload, with the desk's 'denied' decision).
      await agent.publishPermissionRequest({ id: 'perm-deny', tool: 'Write', args: { file_path: 'notes.md' } });
      const denyRes = await uiRpc.call(`${sessionId}:permission`, {
        id: 'perm-deny',
        approved: false,
        decision: 'denied',
        reason: 'Not now',
      });
      expect(denyRes.ok).toBe(true);
      await agent.waitForCompletedPermission('perm-deny');

      const finalSession = await fetchSessionV2(baseUrl, auth.token, sessionId);
      expect(finalSession.pendingPermissionRequestCount ?? 0).toBe(0);
      const finalState = readPlainAgentState(finalSession.agentState);
      expect(finalState.requests ?? {}).toEqual({});
      expect(finalState.completedRequests?.['perm-allow']?.status).toBe('approved');
      expect(finalState.completedRequests?.['perm-deny']).toMatchObject({ status: 'denied', decision: 'denied', reason: 'Not now' });

      expect(agent.getReceivedDecisions().map((d) => [d.id, d.approved, d.decision ?? null])).toEqual([
        ['perm-allow', true, null],
        ['perm-deny', false, 'denied'],
      ]);
    } finally {
      ui.close();
      await agent.stop();
    }
  }, 180_000);
});
