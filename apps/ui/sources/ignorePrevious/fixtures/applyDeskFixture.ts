/**
 * Dev-only: writes the desk fixture straight into the real store, with no server and no sync.
 * Loaded only by the fixture route when EXPO_PUBLIC_IP_FIXTURES=1; never import it anywhere else.
 */
import { storage } from '@/sync/domains/state/storage';
import type { Session } from '@/sync/domains/state/storageTypes';

import { setStoredCoordinatorId } from '../deskPrefs';
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
 * Seeds the store the way a first sync would leave it: the sessions, the coordinator choice for this
 * device, then "ready". `now` stamps every record, so a frozen clock gives the same desk each run.
 */
export function applyDeskFixture(now: number = Date.now()): void {
    const sessions = (scenario.sessions as FixtureSession[]).map((spec, index) => buildSession(spec, index, now));
    setStoredCoordinatorId(scenario.coordinatorId);
    storage.getState().applySessions(sessions);
    storage.getState().applyReady();
}
