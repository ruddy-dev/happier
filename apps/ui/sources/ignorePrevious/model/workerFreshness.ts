import type { SessionListRenderableSession } from '@/sync/domains/session/listing/sessionListRenderable';
import { readSessionRuntimeObservationTimestamps } from '@/sync/domains/session/attention/deriveSessionRuntimePresentationState';
import { isFreshTimestamp, SESSION_RUNTIME_STATUS_STALE_SIGNAL_MS } from '@/utils/sessions/sessionUtils';

/** The latest worker observation, shared by age annotations and Work ordering. */
export function workerLastSignalAt(session: SessionListRenderableSession): number | null {
    // Presence is the repeating witness; a newer runtime/turn/request report is also evidence.
    // updatedAt is deliberately excluded: edits to a title or permission mode aren't worker signals.
    const signals = [
        ...readSessionRuntimeObservationTimestamps(session),
        session.thinkingAt,
        session.latestTurnStatusObservedAt,
        session.latestReadyEventAt,
        session.pendingRequestObservedAt,
    ].filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0);
    return signals.length === 0 ? null : Math.max(...signals);
}

/** An age annotation, not a replacement for getSessionStatus or pending-request settlement. */
export function workerUnheardMinutes(session: SessionListRenderableSession, nowMs: number): number | null {
    if (session.active !== true) return null;
    const lastHeardAt = workerLastSignalAt(session);
    if (lastHeardAt === null) return null;
    return isFreshTimestamp(lastHeardAt, nowMs, SESSION_RUNTIME_STATUS_STALE_SIGNAL_MS)
        ? null
        : Math.floor(Math.max(0, nowMs - lastHeardAt) / 60_000);
}
