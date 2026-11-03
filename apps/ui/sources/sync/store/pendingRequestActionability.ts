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
    let initialAgentRequest: SessionPendingRequest | undefined;
    return (state: Pick<StorageState, 'sessions' | 'sessionMessages'>): boolean => {
        if (displayed.requiresInspection) return false;
        const session = state.sessions?.[sessionId];
        // Standalone/historical controls may predate loaded session state. Their existing
        // interaction grant remains the authority; absence is not conflicting evidence.
        if (!session) return true;
        const agentObservation = observePendingSessionRequest(session, displayed.id, undefined);
        const agentRequest = agentObservation.status === 'pending' ? agentObservation.request : null;
        // A cold mount has no producer publication to bind yet. Retain the first
        // one we observe, even if its content conflicts with the displayed control:
        // a later matching payload must not erase that conflicting evidence.
        if (initialAgentRequest === undefined && agentRequest) initialAgentRequest = agentRequest;
        // Compare successive producer publications to each other, not to a raw
        // tool's unrelated clock. This also protects controls without an index.
        if (initialAgentRequest && agentRequest
            && !isPendingSessionRequestActionable(initialAgentRequest, agentRequest)) return false;
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
        // Revalidate time against the source this control displayed. An inactive
        // user-action observation may use the producer clock while a raw control
        // uses the tool clock; their content must match, not their timestamps.
        let currentPublication: SessionPendingRequest | null = displayed;
        if (initialAgentRequest && displayed.createdAt === initialAgentRequest.createdAt && agentRequest) {
            currentPublication = agentRequest;
        } else if (transcriptState) {
            currentPublication = transcriptState.status === 'pending' ? transcriptState.request : null;
        }
        return observation.status === 'pending' && currentPublication !== null
            && isPendingSessionRequestActionable(displayed, currentPublication)
            && isPendingSessionRequestActionable(displayed, observation.request, { publicationTimesComparable: false });
    };
}
