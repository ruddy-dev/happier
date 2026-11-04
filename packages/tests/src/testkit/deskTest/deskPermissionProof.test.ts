import { randomBytes } from 'node:crypto';
import { expect, test } from 'vitest';
import { encodeBase64, encrypt } from '@/api/encryption';
import { createDeskPermissionProof } from './deskPermissionProof';

test('proof rejects readable plaintext encodings and a wrong session key', () => {
    const key = randomBytes(32);
    const decision = { id: 'proof-permission', approved: true };
    const proof = createDeskPermissionProof('proof-session', key);
    for (const params of [decision, JSON.stringify(decision), Buffer.from(JSON.stringify(decision)).toString('base64'),
        Buffer.from(JSON.stringify({ t: 'plain', v: decision })).toString('base64'),
        encodeBase64(encrypt(randomBytes(32), 'dataKey', decision))]) {
        proof.observe({ method: 'proof-session:permission', params }, decision);
    }
    expect(proof.read().every((entry) => !entry.encrypted && !entry.matchesDecision)).toBe(true);
});

test('proof binds authenticated bytes to the entire accepted decision and the session', () => {
    const key = randomBytes(32);
    const decision = { id: 'proof-permission', approved: true, reason: 'synthetic reason' };
    const params = encodeBase64(encrypt(key, 'dataKey', decision));
    const proof = createDeskPermissionProof('proof-session', key);
    proof.observe({ method: 'proof-session:permission', params }, { ...decision, reason: 'different reason' });
    expect(proof.read()).toEqual([
        { sessionId: 'proof-session', permissionId: decision.id, encrypted: true, matchesDecision: false },
    ]);
    expect(() => proof.observe({ method: 'other-session:permission', params }, decision)).toThrow('session mismatch');
    expect(proof.read()).toHaveLength(1);
});
