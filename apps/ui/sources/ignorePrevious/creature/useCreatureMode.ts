import * as React from 'react';
import { advanceCreatureMode, type CreatureMode, type CreatureModeInput } from './creatureMode';

/** Feed ready wait counts, loaded request identities, and the sessions whose waits are unloaded. */
export function useCreatureMode(input: Omit<CreatureModeInput, 'nowMs'>): CreatureMode {
    const latest = React.useRef(input);
    latest.current = input;
    const inputKey = JSON.stringify(input);
    const [state, setState] = React.useState(() => advanceCreatureMode(null, { ...input, nowMs: Date.now() }));
    React.useEffect(() => {
        setState(previous => advanceCreatureMode(previous, { ...latest.current, nowMs: Date.now() }));
    }, [inputKey]);
    React.useEffect(() => {
        if (state.mode !== 'burst') return;
        const timer = setTimeout(() => {
            setState(previous => advanceCreatureMode(previous, { ...latest.current, nowMs: Date.now() }));
        }, Math.max(0, state.burstUntilMs - Date.now()));
        return () => clearTimeout(timer);
    }, [state]);
    return state.mode;
}
