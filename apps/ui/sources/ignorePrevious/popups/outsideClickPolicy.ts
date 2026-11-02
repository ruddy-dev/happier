export type OutsideClickPolicy = Readonly<{
    presentation: 'docked' | 'overlay';
    hasHalfAnsweredCard: boolean;
}>;

/** Q13 protects unfinished answers only from outside clicks, not explicit dismissal. */
export function shouldCloseOnOutsideClick(policy: OutsideClickPolicy): boolean {
    return policy.presentation === 'overlay' && !policy.hasHalfAnsweredCard;
}
