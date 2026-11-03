export type HoldSpaceState = { phase: 'idle' | 'holding' };
export type HoldSpaceEvent =
    | { type: 'blur' }
    | { type: 'hidden' }
    | {
        type: 'keydown' | 'keyup'; key: string; repeat: boolean;
        shiftKey: boolean; ctrlKey: boolean; altKey: boolean; metaKey: boolean;
        isComposing: boolean; keyCode: number;
        isSessionInput: boolean; isInputEmpty: boolean; dictationActive: boolean; enabled: boolean;
    };
export type HoldSpaceResult = {
    next: HoldSpaceState; action: 'start' | 'release' | 'cancel' | null; preventDefault: boolean;
};

export function reduceHoldSpace(state: HoldSpaceState, event: HoldSpaceEvent): HoldSpaceResult {
    if (state.phase === 'holding') {
        if (event.type === 'blur' || event.type === 'hidden') {
            return { next: { phase: 'idle' }, action: 'release', preventDefault: false };
        }
        if (event.key === ' ') {
            return event.type === 'keyup'
                ? { next: { phase: 'idle' }, action: 'release', preventDefault: true }
                : { next: state, action: null, preventDefault: true };
        }
        if (event.type === 'keydown' && event.key === 'Escape') {
            return { next: { phase: 'idle' }, action: 'cancel', preventDefault: true };
        }
    } else if (event.type === 'keydown' && event.key === ' '
        && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey
        && !event.isComposing && event.keyCode !== 229
        && event.isSessionInput && event.isInputEmpty && event.enabled) {
        // Escape or a session change can reset the gesture while Space is still down.
        // Swallow its remaining repeats without starting another operation.
        if (event.repeat) return { next: state, action: null, preventDefault: true };
        if (!event.dictationActive) return { next: { phase: 'holding' }, action: 'start', preventDefault: true };
    }
    return { next: state, action: null, preventDefault: false };
}
