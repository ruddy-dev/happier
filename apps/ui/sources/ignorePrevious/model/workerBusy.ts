import type { SessionState } from '@/utils/sessions/sessionUtils';

/** Desk Stop covers foreground, background and resuming work, including held prompts. */
export function isDeskWorkerBusy(state: SessionState): boolean {
    return state === 'thinking'
        || state === 'permission_required'
        || state === 'action_required'
        || state === 'resuming'
        || state === 'background_active';
}
