import demo from './demo/desk-demo.json';

/** Compressed story time. Source timestamps stay fixed relative to the fixture's `now`. */
export const DEMO_STEP_MS = 1500;
export type DemoLine = { from: string; text: string; ageMs?: number };
const events = demo.sessions.flatMap(spec => {
    const lines = spec.id === demo.coordinatorId ? demo.coordinatorBody.transcript : ('transcript' in spec ? spec.transcript ?? [] : []);
    return lines.map(line => ({ sessionId: spec.id, line }));
});
const coordinator = events.filter(event => event.sessionId === demo.coordinatorId);
const workers = events.filter(event => event.sessionId !== demo.coordinatorId)
    .sort((a, b) => (b.line.ageMs ?? 0) - (a.line.ageMs ?? 0));
// Interleave the steering exchange with worker progress, then return after the break for the
// final briefing exchange. Text and per-session order always come from the demo, never a copy.
const steering = coordinator.slice(0, -2);
export const demoScript = [
    ...steering.flatMap((event, index) => workers[index] ? [event, workers[index]] : [event]),
    ...workers.slice(steering.length),
    ...coordinator.slice(-2),
];

type Snapshot = { status: 'idle' | 'playing' | 'paused'; started: boolean; step: number; transcript: readonly DemoLine[] };

/** One fixture lifetime owns both the timer and the coordinator's local presentation source. */
export function createDemoConversation(write: (step: number, reset: boolean) => void) {
    let snapshot: Snapshot = { status: 'idle', started: false, step: 0, transcript: demo.coordinatorBody.transcript };
    let timer: ReturnType<typeof setTimeout> | null = null;
    let released = false;
    const listeners = new Set<() => void>();
    const publish = (next: Snapshot) => {
        snapshot = next;
        for (const listener of listeners) listener();
    };
    const stopTimer = () => {
        if (timer !== null) clearTimeout(timer);
        timer = null;
    };
    const schedule = () => {
        if (released || snapshot.status !== 'playing') return;
        timer = setTimeout(() => {
            timer = null;
            if (released || snapshot.status !== 'playing') return;
            const step = snapshot.step + 1;
            write(step, false);
            const event = demoScript[step - 1];
            publish({
                ...snapshot,
                step,
                status: step === demoScript.length ? 'idle' : 'playing',
                transcript: event.sessionId === demo.coordinatorId ? [...snapshot.transcript, event.line] : snapshot.transcript,
            });
            if (snapshot.status === 'playing') schedule();
        }, DEMO_STEP_MS);
    };
    const restart = () => {
        if (released) return;
        stopTimer();
        write(0, true);
        publish({ status: 'playing', started: true, step: 0, transcript: [] });
        schedule();
    };
    const player = {
        getSnapshot: () => snapshot,
        subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
        play() {
            if (released || snapshot.status === 'playing') return;
            if (snapshot.status === 'idle') { restart(); return; }
            publish({ ...snapshot, status: 'playing' });
            schedule();
        },
        pause() {
            if (released || snapshot.status !== 'playing') return;
            stopTimer();
            publish({ ...snapshot, status: 'paused' });
        },
        restart,
        release() {
            if (released) return;
            released = true;
            stopTimer();
            listeners.clear();
            if (active === player) active = null;
        },
    };
    return player;
}

let active: ReturnType<typeof createDemoConversation> | null = null;
export function getDemoConversation() { return active; }
export function mountDemoConversation(write: (step: number, reset: boolean) => void) {
    active?.release();
    active = createDemoConversation(write);
    return active;
}
