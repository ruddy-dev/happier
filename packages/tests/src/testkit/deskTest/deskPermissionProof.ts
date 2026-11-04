import { isDeepStrictEqual } from 'node:util';
import { decodeBase64, decrypt } from '@/api/encryption';
import type { PermissionDecision } from '../syntheticAgent/syntheticAgent';

export type DeskPermissionEvidence = Readonly<{
    sessionId: string;
    permissionId: string;
    encrypted: boolean;
    matchesDecision: boolean;
}>;

/** Called only at SyntheticAgent's accepted RPC boundary. Never retains bytes or payloads. */
export function createDeskPermissionProof(sessionId: string, dataKey: Uint8Array | null) {
    const evidence: DeskPermissionEvidence[] = [];
    return {
        observe(request: Readonly<{ method: string; params: unknown }>, decision: PermissionDecision) {
            if (request.method !== `${sessionId}:permission`) throw new Error('Permission proof session mismatch');
            // Independently use the production CLI cipher/parser to check the actual accepted
            // bytes. A string (including base64-encoded plaintext) is not proof of encryption.
            const decoded = dataKey && typeof request.params === 'string'
                ? decrypt(dataKey, 'dataKey', decodeBase64(request.params))
                : null;
            evidence.push({
                sessionId,
                permissionId: decision.id,
                encrypted: dataKey !== null && decoded !== null,
                matchesDecision: isDeepStrictEqual(dataKey ? decoded : request.params, decision),
            });
        },
        read: (): readonly DeskPermissionEvidence[] => evidence.map((entry) => ({ ...entry })),
    };
}
