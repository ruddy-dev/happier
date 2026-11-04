import type { CapturedEvent } from '../socketClient';
import { type SocketCollector } from '../socketClient';
import { decryptDataKeyBase64, encryptDataKeyBase64 } from '../rpcCrypto';
import { deriveActivitySummaryFromAgentState } from '@/api/session/deriveActivitySummaryFromAgentState';
import type { AgentState as CliAgentState } from '@/api/types';
import { fetchSessionV2 } from '../sessions';
import { sleep, waitFor } from '../timing';
import { createMachineBoundSessionScopedSocketCollector } from '../sessionSocketBinding';
import { unwrapSerializedJsonValue } from '../unwrapSerializedJsonValue';

type PermissionRequest = {
  id: string;
  tool: string;
  args: unknown;
};

export type PermissionDecision = {
  id: string;
  approved: boolean;
  reason?: string;
  mode?: string;
  allowedTools?: string[];
  decision?: string;
  execPolicyAmendment?: { command: string[] };
  answers?: Record<string, string>;
};

type AgentStateShape = {
  requests?: Record<string, { tool: string; arguments: unknown; createdAt?: number | null }>;
  completedRequests?: Record<
    string,
    {
      tool: string;
      arguments: unknown;
      createdAt?: number | null;
      completedAt?: number | null;
      status: 'canceled' | 'denied' | 'approved';
      reason?: string | null;
      mode?: string | null;
      allowedTools?: string[] | null;
      decision?: string | null;
    }
  >;
};

export function computeVersionMismatchBackoffMs(attempt: number): number {
  const boundedAttempt = Math.max(1, Math.floor(attempt));
  const base = 25;
  const cap = 750;
  const exponential = Math.min(cap, base * 2 ** (boundedAttempt - 1));
  const jitter = (boundedAttempt * 17) % 31;
  return exponential + jitter;
}

/**
 * How the agent encodes agentState and RPC payloads. Mirrors the CLI: e2ee sessions use the session
 * data key; plain sessions store agentState as a JSON string and pass RPC params/results through raw.
 */
export type SyntheticAgentEncryption = Readonly<{ type: 'dataKey'; dataKey: Uint8Array }> | Readonly<{ type: 'plain' }>;

type SyntheticAgentCodec = Readonly<{
  encodeState: (state: AgentStateShape) => string;
  decodeState: (value: string) => AgentStateShape | null;
  encodeRpc: (value: unknown) => unknown;
  decodeRpc: (value: unknown) => unknown;
}>;

function createCodec(encryption: SyntheticAgentEncryption): SyntheticAgentCodec {
  if (encryption.type === 'plain') {
    return {
      encodeState: (state) => JSON.stringify(state),
      decodeState: (value) => {
        try {
          return JSON.parse(value) as AgentStateShape | null;
        } catch {
          return null;
        }
      },
      encodeRpc: (value) => value,
      decodeRpc: (value) => value,
    };
  }
  const { dataKey } = encryption;
  return {
    encodeState: (state) => encryptDataKeyBase64(state, dataKey),
    decodeState: (value) => unwrapSerializedJsonValue(decryptDataKeyBase64(value, dataKey)) as AgentStateShape | null,
    encodeRpc: (value) => encryptDataKeyBase64(value, dataKey),
    decodeRpc: (value) => (typeof value === 'string' ? unwrapSerializedJsonValue(decryptDataKeyBase64(value, dataKey)) : null),
  };
}

/** Pass `dataKey` for an e2ee session (the original form) or `encryption` to choose the mode explicitly. */
export type SyntheticAgentParams = Readonly<{
  baseUrl: string;
  token: string;
  sessionId: string;
  /** In-memory observation of the accepted RPC, independent of polling/WebSocket transport. */
  onPermissionDecision?: (request: Readonly<{ method: string; params: unknown }>, decision: PermissionDecision) => void;
}> &
  (Readonly<{ dataKey: Uint8Array }> | Readonly<{ encryption: SyntheticAgentEncryption }>);

export class SyntheticAgent {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly sessionId: string;
  private readonly codec: SyntheticAgentCodec;
  private readonly receivedDecisions: PermissionDecision[] = [];
  private readonly onPermissionDecision: SyntheticAgentParams['onPermissionDecision'];
  private socket: SocketCollector | null = null;

  constructor(params: SyntheticAgentParams) {
    this.baseUrl = params.baseUrl;
    this.token = params.token;
    this.sessionId = params.sessionId;
    this.onPermissionDecision = params.onPermissionDecision;
    this.codec = createCodec('encryption' in params ? params.encryption : { type: 'dataKey', dataKey: params.dataKey });
  }

  getEvents(): CapturedEvent[] {
    return this.socket?.getEvents() ?? [];
  }

  /** Permission decisions this agent received over RPC, in arrival order. */
  getReceivedDecisions(): readonly PermissionDecision[] {
    return [...this.receivedDecisions];
  }

  async start(): Promise<void> {
    if (!this.socket) {
      const created = await createMachineBoundSessionScopedSocketCollector({
        baseUrl: this.baseUrl,
        token: this.token,
        sessionId: this.sessionId,
      });
      this.socket = created.socket;
    }

    const socket = this.socket;
    if (!socket) {
      throw new Error('SyntheticAgent socket initialization failed');
    }

    socket.connect();
    await waitFor(() => socket.isConnected(), { timeoutMs: 20_000 });

    const method = `${this.sessionId}:permission`;
    socket.onRpcRequest(async (req) => {
      if (req.method !== method) {
        // Return a METHOD_NOT_FOUND-like response in the session's encoding; server also guards this.
        return this.codec.encodeRpc({ error: 'method-not-found' });
      }

      const decision = this.codec.decodeRpc(req.params) as PermissionDecision | null;
      if (!decision || typeof decision.id !== 'string') {
        return this.codec.encodeRpc({ error: 'invalid-request' });
      }

      this.receivedDecisions.push(decision);
      this.onPermissionDecision?.(req, decision);
      await this.applyPermissionDecision(decision);
      return this.codec.encodeRpc({ ok: true });
    });

    await socket.rpcRegister(method);
  }

  async stop(): Promise<void> {
    this.socket?.close();
  }

  async publishPermissionRequest(req: PermissionRequest): Promise<void> {
    const now = Date.now();
    await this.updateAgentStateWithRetry((state) => {
      const next: AgentStateShape = { ...state };
      const requests = { ...(next.requests ?? {}) };
      requests[req.id] = { tool: req.tool, arguments: req.args, createdAt: now };
      next.requests = requests;
      return next;
    });
  }

  async waitForCompletedPermission(permissionId: string, opts?: { timeoutMs?: number }): Promise<void> {
    await waitFor(async () => {
      const session = await fetchSessionV2(this.baseUrl, this.token, this.sessionId);
      const state = session.agentState ? this.codec.decodeState(session.agentState) : null;
      const completed = state?.completedRequests ?? {};
      return Boolean(completed && completed[permissionId]);
    }, { timeoutMs: opts?.timeoutMs ?? 15_000, intervalMs: 100, context: `completed permission ${permissionId}` });
  }

  private async applyPermissionDecision(decision: PermissionDecision): Promise<void> {
    const now = Date.now();
    await this.updateAgentStateWithRetry((state) => {
      const next: AgentStateShape = { ...state };
      const existingReq = next.requests?.[decision.id];

      const requests = { ...(next.requests ?? {}) };
      delete requests[decision.id];
      next.requests = requests;

      const completedRequests = { ...(next.completedRequests ?? {}) };
      completedRequests[decision.id] = {
        tool: existingReq?.tool ?? 'Unknown',
        arguments: existingReq?.arguments ?? {},
        createdAt: existingReq?.createdAt ?? null,
        completedAt: now,
        status: decision.approved ? 'approved' : 'denied',
        reason: decision.reason ?? null,
        mode: decision.mode ?? null,
        allowedTools: decision.allowedTools ?? null,
        decision: decision.decision ?? (decision.approved ? 'approved' : 'denied'),
      };
      next.completedRequests = completedRequests;
      return next;
    });
  }

  /**
   * Writes agentState the way the CLI does: socket `update-state` with the derived `activitySummaryV1`,
   * so the server's pending-request counts (list attention, badges) move with the requests.
   */
  private async updateAgentStateWithRetry(updater: (state: AgentStateShape) => AgentStateShape): Promise<void> {
    const socket = this.socket;
    if (!socket?.isConnected()) {
      throw new Error('SyntheticAgent must be started before it writes agentState');
    }
    const attempts = 10;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      const session = await fetchSessionV2(this.baseUrl, this.token, this.sessionId);
      const current = session.agentState ? this.codec.decodeState(session.agentState) : null;
      const currentState: AgentStateShape = current && typeof current === 'object' ? current : {};
      const nextState = updater(currentState);

      const answer = await socket.emitWithAck<{ result?: unknown }>('update-state', {
        sid: this.sessionId,
        expectedVersion: session.agentStateVersion,
        agentState: this.codec.encodeState(nextState),
        // AgentStateShape is looser than the CLI type (createdAt may be missing); the derivation reads only requests and completedRequests.
        activitySummaryV1: deriveActivitySummaryFromAgentState(nextState as CliAgentState),
      });

      if (answer?.result === 'success') return;
      if (answer?.result === 'version-mismatch') {
        await sleep(computeVersionMismatchBackoffMs(attempt));
        continue;
      }
      throw new Error(`Failed to update agentState (${String(answer?.result)})`);
    }
    throw new Error(`Failed to update agentState due to repeated version mismatches (attempts=${attempts})`);
  }
}
