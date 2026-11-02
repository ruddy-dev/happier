/**
 * Dev-only: writes the desk fixture straight into the real store, with no server and no sync.
 * Loaded only by the fixture route when EXPO_PUBLIC_IP_FIXTURES=1; never import it anywhere else.
 */
import { resolveWarmCacheAccountScope } from '@/sync/domains/state/warmCachePersistence';
import { registerDeskFixtureRelease, releaseDeskFixture } from '../deskFixtureGate';
import { storage } from '@/sync/domains/state/storage';
import type { Session } from '@/sync/domains/state/storageTypes';

import { setCoordinatorOverride } from '../deskPrefs';
import scenario from './desk-fixture.json';

type FixtureSession = {
    id: string;
    path: string;
    title: string;
    active: boolean;
    thinking?: boolean;
    request?: { tool: string; arguments: Record<string, unknown> };
};

/** The string the ship guard greps built output for. It must appear only in this folder. */
export const DESK_FIXTURE_MARKER: string = scenario.marker;

function buildSession(spec: FixtureSession, index: number, now: number): Session {
    const request = spec.request;
    return {
        id: spec.id,
        seq: 1,
        createdAt: now - 3_600_000,
        updatedAt: now - index * 1000,
        active: spec.active,
        activeAt: now,
        metadata: {
            path: spec.path,
            host: 'fixture-host',
            homeDir: '/work',
            machineId: 'fx-machine',
            flavor: 'claude',
            summary: { text: spec.title, updatedAt: now },
        } as Session['metadata'],
        metadataVersion: 1,
        agentState: request
            ? ({
                  requests: { [`${spec.id}-r1`]: { tool: request.tool, arguments: request.arguments, createdAt: now - 30_000 } },
              } as unknown as Session['agentState'])
            : null,
        agentStateVersion: 1,
        thinking: Boolean(spec.thinking),
        thinkingAt: spec.thinking ? now : 0,
        presence: 'online',
    };
}

/**
 * Seeds the store the way a first sync would leave it: the sessions, the coordinator for this device, then
 * "ready". `now` stamps every record, so a frozen clock gives the same desk each run.
 *
 * Nothing here is persisted: the coordinator is an in-memory override, not the stored choice. The sessions
 * are in the store, though, and the store feeds an account's warm cache once someone signs in, so the caller
 * must call the returned `release` when it stops showing the desk. It deletes only the fixture's sessions and
 * puts readiness back as it was.
 */
export function applyDeskFixture(now: number = Date.now()): () => void {
    if (resolveWarmCacheAccountScope(storage.getState().profile.id)) {
        throw new Error('Desk fixture cannot run with an account');
    }
    releaseDeskFixture();
    const specs = scenario.sessions as FixtureSession[];
    const wasReady = storage.getState().isDataReady;
    let released = false;
    const release = () => {
        if (released) return;
        released = true;
        unregister();
        storage.getState().deleteSessions(specs.map((spec) => spec.id));
        if (!wasReady) storage.setState({ isDataReady: false });
        setCoordinatorOverride(null);
    };
    const unregister = registerDeskFixtureRelease(release);
    try {
        setCoordinatorOverride(scenario.coordinatorId);
        storage.getState().applySessions(specs.map((spec, index) => buildSession(spec, index, now)));
        storage.getState().applyReady();
    } catch (error) {
        release();
        throw error;
    }
    return release;
}
