import type { SessionState } from '@/utils/sessions/sessionUtils';

/** The antenna-bulb colour on a worker or issue face: yellow, red, warm grey or unlit. */
export type Bulb = 'turn' | 'stuck' | 'working' | 'idle';

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
export const BULB_RANK: Record<Bulb, number> = { turn: 0, stuck: 1, working: 2, idle: 3 };

export function bulbFromSessionState(state: SessionState): Bulb {
    return BULB_BY_STATE[state];
}

export function issueBulb(bulbs: readonly Bulb[]): Bulb {
    let best: Bulb = 'idle';
    for (const bulb of bulbs) if (BULB_RANK[bulb] < BULB_RANK[best]) best = bulb;
    return best;
}
