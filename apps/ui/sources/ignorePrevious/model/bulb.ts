import type { SessionState } from '@/utils/sessions/sessionUtils';
import { isDeskWorkerBusy } from './workerBusy';

/** The antenna-bulb colour on a worker or issue face: yellow, red, warm grey or unlit. */
export type Bulb = 'turn' | 'stuck' | 'working' | 'waiting' | 'idle';

const BULB_BY_STATE: Record<SessionState, Bulb> = {
    permission_required: 'turn',
    action_required: 'turn',
    failed: 'stuck',
    recoverable_unservable: 'stuck',
    thinking: 'working',
    background_active: 'working',
    resuming: 'working',
    archiving: 'working',
    waiting: 'idle',
    disconnected: 'idle',
};

/** Lower is more urgent. */
export const BULB_RANK: Record<Bulb, number> = { turn: 0, stuck: 1, working: 2, waiting: 3, idle: 4 };

export function bulbFromSessionState(state: SessionState, usageLimited = false): Bulb {
    const bulb = BULB_BY_STATE[state];
    // A busy worker has resumed, even while its last limit remains visible.
    if (bulb === 'turn') return bulb;
    if (isDeskWorkerBusy(state)) return 'working';
    return usageLimited ? 'waiting' : bulb;
}

export function issueBulb(bulbs: readonly Bulb[]): Bulb {
    let best: Bulb = 'idle';
    for (const bulb of bulbs) if (BULB_RANK[bulb] < BULB_RANK[best]) best = bulb;
    return best;
}
