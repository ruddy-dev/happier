type ReducedMotionModule = typeof import('@/hooks/ui/useReducedMotionPreference');

/** A fixed preference, or a getter read on every call so one hoisted `vi.mock` can serve several cases. */
export type ReducedMotionPreferenceSource = boolean | (() => boolean);

/**
 * The OS reduced-motion setting is a host boundary. Use as
 * `vi.mock('@/hooks/ui/useReducedMotionPreference', installReducedMotionMock(...))`.
 */
export function createReducedMotionModuleMock(
    reduced: ReducedMotionPreferenceSource = false,
): Pick<ReducedMotionModule, 'useReducedMotionPreference'> {
    return { useReducedMotionPreference: typeof reduced === 'function' ? reduced : () => reduced };
}

export function installReducedMotionMock(reduced: ReducedMotionPreferenceSource = false) {
    return () => createReducedMotionModuleMock(reduced);
}
