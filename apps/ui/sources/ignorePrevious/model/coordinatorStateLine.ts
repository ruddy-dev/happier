import type { SessionStatus } from '@/utils/sessions/sessionUtils';

export type CoordinatorStateLine = Readonly<
    { kind: 'thinking' | 'idle' | 'offline' } | { kind: 'waiting'; count: number }
>;

/** Desk presentation of the canonical session status and ATR-30's shared wait count. */
export function coordinatorStateLine(
    status: Pick<SessionStatus, 'state' | 'isConnected'> | null,
    waitingCount: number | null,
): CoordinatorStateLine | null {
    if (!status?.isConnected) return { kind: 'offline' };
    if (status.state === 'thinking') return { kind: 'thinking' };
    if (waitingCount === null) return null;
    if (waitingCount > 0) return { kind: 'waiting', count: waitingCount };
    return { kind: 'idle' };
}
