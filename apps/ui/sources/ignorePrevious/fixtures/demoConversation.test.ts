import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { storage } from '@/sync/domains/state/storage';
import { releaseDeskFixture } from '../deskFixtureGate';
import { applyDeskFixture } from './applyDeskFixture';
import demo from './demo/desk-demo.json';
import { DEMO_STEP_MS, demoScript, getDemoConversation, mountDemoConversation } from './demoConversation';

const NOW = Date.UTC(2026, 10, 1, 14, 2);
const ids = demo.sessions.map(session => session.id);
function snapshot() {
    return ids.map(id => ({
        session: storage.getState().sessions[id],
        messages: Object.values(storage.getState().sessionMessages[id]?.messagesById ?? {})
            .filter(message => message.kind === 'user-text' || message.kind === 'agent-text')
            .map(({ id: _renderKey, ...message }) => message),
        loaded: storage.getState().sessionMessages[id]?.isLoaded,
    }));
}
function player() {
    const value = getDemoConversation();
    expect(value).not.toBeNull();
    return value!;
}

describe('scripted demo on the real fixture stores', () => {
    const before = storage.getState();
    beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); storage.setState(before, true); });
    afterEach(() => { releaseDeskFixture(); getDemoConversation()?.release(); storage.setState(before, true); vi.useRealTimers(); });

    it('derives all six sessions, the question, PR and briefing in source order, interleaving workers', () => {
        expect(new Set(demoScript.map(step => step.sessionId))).toEqual(new Set(ids));
        expect(demoScript.slice(0, 4).map(step => step.sessionId === demo.coordinatorId)).toEqual([true, false, true, false]);
        const question = demoScript.find(step => /One choice needs/.test(step.line.text));
        expect(question?.sessionId).toBe('demo-recipe-search');
        const prIndex = demoScript.findIndex(step => /Opened PR #42/.test(step.line.text));
        const briefIndex = demoScript.findIndex(step => /Brief me after my break/.test(step.line.text));
        expect(prIndex).toBeGreaterThan(0);
        expect(briefIndex).toBeGreaterThan(prIndex);
        expect(demoScript[briefIndex + 1]?.line).toEqual(demo.coordinatorBody.transcript.at(-1));
        expect(demoScript.slice(0, briefIndex).some(step => step.sessionId !== demo.coordinatorId)).toBe(true);
        for (const id of ids) {
            const spec = demo.sessions.find(session => session.id === id)!;
            expect(demoScript.filter(step => step.sessionId === id).map(step => step.line)).toEqual(
                id === demo.coordinatorId ? demo.coordinatorBody.transcript : 'transcript' in spec ? spec.transcript : [],
            );
        }
    });

    it('play resets to a reduced start, advances exactly once per tick, pauses and resumes', () => {
        applyDeskFixture(NOW, 'demo');
        const run = player();
        run.play();
        run.play(); // A second press cannot create a second advancing timer.
        expect(run.getSnapshot()).toMatchObject({ status: 'playing', started: true, step: 0, transcript: [] });
        expect(storage.getState().sessions['demo-recipe-search'].agentState).toBeNull();
        expect(snapshot().every(row => row.messages.length === 0)).toBe(true);
        vi.advanceTimersByTime(DEMO_STEP_MS - 1);
        expect(run.getSnapshot().step).toBe(0);
        vi.advanceTimersByTime(1);
        expect(run.getSnapshot().step).toBe(1);
        expect(run.getSnapshot().transcript).toEqual([demo.coordinatorBody.transcript[0]]);
        run.pause();
        const paused = snapshot();
        vi.advanceTimersByTime(DEMO_STEP_MS * 3);
        expect(run.getSnapshot()).toMatchObject({ status: 'paused', step: 1 });
        expect(snapshot()).toEqual(paused);
        run.play();
        vi.advanceTimersByTime(DEMO_STEP_MS);
        expect(run.getSnapshot()).toMatchObject({ status: 'playing', step: 2 });
    });

    it('reveals requests with their worker lines and finishes in the exact static demo state', () => {
        applyDeskFixture(NOW, 'demo');
        const expected = snapshot();
        const run = player();
        run.play();
        let sawThinking = false;
        for (const [index, step] of demoScript.entries()) {
            vi.advanceTimersByTime(DEMO_STEP_MS);
            expect(run.getSnapshot().step).toBe(index + 1);
            sawThinking ||= Boolean(storage.getState().sessions['demo-weather-fix'].thinking);
            const shown = demoScript.slice(0, index + 1);
            for (const spec of demo.sessions) {
                if (!('request' in spec)) continue;
                const last = demoScript.filter(event => event.sessionId === spec.id).at(-1)!;
                expect(Boolean(storage.getState().sessions[spec.id].agentState?.requests)).toBe(shown.includes(last));
            }
            if (step.sessionId === 'demo-weather-fix' && /Opened PR/.test(step.line.text)) {
                expect(storage.getState().sessions[step.sessionId].active).toBe(false);
            }
        }
        expect(sawThinking).toBe(true);
        expect(snapshot()).toEqual(expected);
        expect(run.getSnapshot()).toMatchObject({ status: 'idle', started: true, transcript: demo.coordinatorBody.transcript });
        const finished = snapshot();
        vi.advanceTimersByTime(DEMO_STEP_MS * 3);
        expect(snapshot()).toEqual(finished);
    });

    it('restart is deterministic twice, clears messages and pending requests, then can replay', () => {
        applyDeskFixture(NOW, 'demo');
        const run = player();
        run.play();
        vi.advanceTimersByTime(DEMO_STEP_MS * demoScript.length);
        run.restart();
        const initial = snapshot();
        expect(run.getSnapshot()).toMatchObject({ status: 'playing', step: 0, transcript: [] });
        expect(initial.every(row => row.messages.length === 0 && row.session?.agentState === null)).toBe(true);
        vi.advanceTimersByTime(DEMO_STEP_MS * 8);
        run.pause();
        run.restart();
        expect(snapshot()).toEqual(initial);
        vi.advanceTimersByTime(DEMO_STEP_MS);
        expect(run.getSnapshot().step).toBe(1);
    });

    it('does not schedule a timer if a playback subscriber releases the fixture', () => {
        const release = applyDeskFixture(NOW, 'demo');
        const run = player();
        run.subscribe(release);
        run.play();
        expect(getDemoConversation()).toBeNull();
        expect(vi.getTimerCount()).toBe(0);
    });

    it.each([
        ['seed', 1],
        ['restart', 1],
        ['restart', 3],
        ['step', 2],
        ['completion', 1],
        ['completion', 4],
    ] as const)('release from real storage during %s write %i stops the entire fixture write sequence', (phase, releaseAt) => {
        if (phase !== 'seed') {
            applyDeskFixture(NOW, 'demo');
            player().play();
            if (phase === 'restart') vi.advanceTimersByTime(DEMO_STEP_MS * 3);
            if (phase === 'completion') vi.advanceTimersByTime(DEMO_STEP_MS * (demoScript.length - 1));
        }
        let notifications = 0;
        let releasing = false;
        let releaseReturned = false;
        const laterWrites = vi.fn();
        const unsubscribe = storage.subscribe(() => {
            if (releaseReturned) { laterWrites(); return; }
            if (releasing || ++notifications !== releaseAt) return;
            releasing = true;
            releaseDeskFixture();
            // Cleanup writes are allowed inside release, but none may follow its return.
            releaseReturned = true;
        });
        try {
            if (phase === 'seed') applyDeskFixture(NOW, 'demo');
            else if (phase === 'restart') player().restart();
            else vi.advanceTimersByTime(DEMO_STEP_MS);
            expect(releaseReturned).toBe(true);
            expect(ids.filter(id => storage.getState().sessions[id])).toEqual([]);
            expect(ids.filter(id => storage.getState().sessionMessages[id])).toEqual([]);
            expect(getDemoConversation()).toBeNull();
            vi.advanceTimersByTime(DEMO_STEP_MS * demoScript.length);
            expect(laterWrites).not.toHaveBeenCalled();
            expect(vi.getTimerCount()).toBe(0);
        } finally {
            unsubscribe();
        }
    });

    it('mounting a second player releases the playing predecessor', () => {
        const oldWrite = vi.fn();
        const old = mountDemoConversation(oldWrite);
        old.play();
        oldWrite.mockClear();
        const nextWrite = vi.fn();
        const next = mountDemoConversation(nextWrite);
        expect(getDemoConversation()).toBe(next);
        next.play();
        nextWrite.mockClear();
        vi.advanceTimersByTime(DEMO_STEP_MS);
        old.play(); old.restart();
        old.release();
        expect(oldWrite).not.toHaveBeenCalled();
        expect(nextWrite).toHaveBeenCalledWith(1, false);
        expect(getDemoConversation()).toBe(next);
    });

    it.each(['release', 'replace'] as const)('%s mid-play cancels timers, subscriptions and later store writes', action => {
        const release = applyDeskFixture(NOW, 'demo');
        const run = player();
        run.play();
        vi.advanceTimersByTime(DEMO_STEP_MS * Math.floor(demoScript.length / 2));
        expect(vi.getTimerCount()).toBe(1);
        if (action === 'release') release(); else applyDeskFixture(NOW);
        expect(vi.getTimerCount()).toBe(0);
        expect(getDemoConversation()).toBeNull();
        const writes = vi.fn();
        const unsubscribe = storage.subscribe(writes);
        vi.advanceTimersByTime(DEMO_STEP_MS * demoScript.length);
        run.play(); run.restart();
        expect(writes).not.toHaveBeenCalled();
        unsubscribe();
    });
});
