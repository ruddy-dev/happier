import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createSessionFixture } from '@/dev/testkit/fixtures/sessionFixtures';
import { storage } from '@/sync/domains/state/storage';

import { releaseDeskFixture } from '../deskFixtureGate';
import { getStoredCoordinatorId, setCoordinatorOverride, setStoredCoordinatorId } from '../deskPrefs';
import { issueKeyFromPath, issueKeyFromTitle } from '../model/issueKey';
import scenario from './desk-fixture.json';
import { DESK_FIXTURE_MARKER, applyDeskFixture } from './applyDeskFixture';

// 1 Nov 2026, 14:02 UTC: the clock the screenshot run freezes.
const NOW = Date.UTC(2026, 10, 1, 14, 2, 0);

describe('applyDeskFixture', () => {
    const before = storage.getState();
    const storedBefore = getStoredCoordinatorId();

    beforeEach(() => {
        storage.setState(before, true);
        setStoredCoordinatorId(null);
        setCoordinatorOverride(null);
    });

    afterEach(() => {
        releaseDeskFixture();
        storage.setState(before, true);
        setCoordinatorOverride(null);
        setStoredCoordinatorId(storedBefore);
    });

    it('puts every fixture session in the store and finishes the first sync', () => {
        expect(storage.getState().isDataReady).toBe(false);

        applyDeskFixture(NOW);

        const sessions = storage.getState().sessions;
        expect(Object.keys(sessions).sort()).toEqual(scenario.sessions.map((s) => s.id).sort());
        expect(storage.getState().isDataReady).toBe(true);
    });

    it('shows the fixture coordinator, which is one of the sessions', () => {
        applyDeskFixture(NOW);

        expect(getStoredCoordinatorId()).toBe(scenario.coordinatorId);
        expect(storage.getState().sessions[scenario.coordinatorId]).toBeDefined();
    });

    it('never touches a coordinator choice that is already stored on this device', () => {
        setStoredCoordinatorId('real-coord-session');

        const release = applyDeskFixture(NOW);
        release();

        // The override is gone and the persisted pick was never written over.
        expect(getStoredCoordinatorId()).toBe('real-coord-session');
    });

    it('hands back a release that removes the fixture sessions and leaves other sessions and readiness as they were', () => {
        storage.getState().applySessions([createSessionFixture({ id: 'real-1', active: true })]);
        expect(storage.getState().isDataReady).toBe(false);

        const release = applyDeskFixture(NOW);
        expect(Object.keys(storage.getState().sessions)).toContain('fx-coord');
        release();

        expect(Object.keys(storage.getState().sessions)).toEqual(['real-1']);
        expect(Object.keys(storage.getState().sessionListRenderables)).toEqual(['real-1']);
        expect(storage.getState().isDataReady).toBe(false);
        expect(getStoredCoordinatorId()).toBeNull();
    });

    it('seeds a pending tool request, a working agent and a stopped agent', () => {
        applyDeskFixture(NOW);
        const sessions = storage.getState().sessions;

        const asking = scenario.sessions.find((s) => 'request' in s)!;
        const requests = Object.values(sessions[asking.id]!.agentState?.requests ?? {});
        expect(requests).toHaveLength(1);
        expect(requests[0]!.createdAt).toBeLessThan(NOW);

        const working = scenario.sessions.find((s) => 'thinking' in s && s.thinking)!;
        expect(sessions[working.id]!.thinking).toBe(true);
        expect(sessions[working.id]!.active).toBe(true);

        const stopped = scenario.sessions.find((s) => !s.active)!;
        expect(sessions[stopped.id]!.active).toBe(false);
    });

    it('stamps every record from the clock it is given, so a frozen clock gives an identical desk', () => {
        applyDeskFixture(NOW);
        for (const session of Object.values(storage.getState().sessions)) {
            expect(session.updatedAt).toBeLessThanOrEqual(NOW);
            expect(session.updatedAt).toBeGreaterThan(NOW - 3_600_000);
        }
    });

    it('gives the scratch session a title and folder with no issue id, distinct from every other title', () => {
        const scratch = scenario.sessions.find((s) => s.path.endsWith('/scratch'))!;
        expect(issueKeyFromTitle(scratch.title)).toBeNull();
        expect(issueKeyFromPath(scratch.path)).toBeNull();
        const titles = scenario.sessions.map((s) => s.title);
        expect(new Set(titles).size).toBe(titles.length);
    });

    it('can be applied twice without duplicating sessions', () => {
        applyDeskFixture(NOW);
        applyDeskFixture(NOW);
        expect(Object.keys(storage.getState().sessions)).toHaveLength(scenario.sessions.length);
    });

    it('carries the marker the ship guard greps for', () => {
        expect(DESK_FIXTURE_MARKER).toBe('ip-fixture-marker-7f3a');
    });
});
