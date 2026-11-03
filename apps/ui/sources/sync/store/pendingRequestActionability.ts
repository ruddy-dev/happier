import type { StorageState } from './types';
import { readStoredSessionMessages } from '@/sync/domains/messages/readStoredSessionMessages';
import {
    collectTranscriptRequestStates,
    isPendingSessionRequestActionable,
    observePendingSessionRequest,
    type SessionPendingRequest,
    type TranscriptRequestState,
} from '@/sync/domains/session/pending/listPendingSessionRequests';

/** One request, using the maintained index. Older message-array stores are read only when changed. */
export function createPendingRequestActionabilitySelector(sessionId: string, displayed: SessionPendingRequest) {
    let previousEntry: StorageState['sessionMessages'][string] | undefined;
    let legacyStates = new Map<string, TranscriptRequestState>();
    return (state: Pick<StorageState, 'sessions' | 'sessionMessages'>): boolean => {
        if (displayed.requiresInspection) return false;
        const session = state.sessions?.[sessionId];
        // Standalone/historical controls may predate loaded session state. Their existing
        // interaction grant remains the authority; absence is not conflicting evidence.
        if (!session) return true;
        const entry = state.sessionMessages?.[sessionId];
        let transcriptState: TranscriptRequestState | undefined;
        if (entry?.renderableAggregate) {
            transcriptState = entry.renderableAggregate.requestStates.get(displayed.id);
        } else if (entry) {
            if (previousEntry !== entry) {
                legacyStates = new Map();
                collectTranscriptRequestStates(readStoredSessionMessages(state, sessionId), legacyStates);
                previousEntry = entry;
            }
            transcriptState = legacyStates.get(displayed.id);
        }
        // A raw transcript control is itself pending evidence when an older/partial
        // store lacks an index entry. Never replace actual terminal/indexed evidence.
        const observation = observePendingSessionRequest(session, displayed.id, transcriptState ?? {
            status: 'pending', request: displayed, createdAt: displayed.createdAt ?? 0,
        });
        return observation.status === 'pending' && isPendingSessionRequestActionable(displayed, observation.request);
    };
}
