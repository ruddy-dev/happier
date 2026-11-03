/**
 * Dev-only: writes the desk fixture straight into the real store, with no server and no sync.
 * Loaded only by the fixture route when EXPO_PUBLIC_IP_FIXTURES=1; never import it anywhere else.
 */
import { resolveWarmCacheAccountScope } from '@/sync/domains/state/warmCachePersistence';
import { registerDeskFixtureRelease, releaseDeskFixture } from '../deskFixtureGate';
import { storage } from '@/sync/domains/state/storage';
import type { NormalizedMessage } from '@/sync/typesRaw';
import type { Session } from '@/sync/domains/state/storageTypes';

import { setCoordinatorOverride } from '../deskPrefs';
import scenario from './desk-fixture.json';
import demo from './demo/desk-demo.json';

type FixtureLine = { from: string; text: string; ageMs?: number };
type FixtureScenario = {
    coordinatorId: string;
    sessions: FixtureSession[];
    coordinatorBody: { transcript: FixtureLine[] };
};

type FixtureSession = {
    id: string;
    path: string;
    title: string;
    active: boolean;
    thinking?: boolean;
    request?: { tool: string; kind?: string; arguments: Record<string, unknown> };
    transcript?: FixtureLine[];
};

/** The string the ship guard greps built output for. It must appear only in this folder. */
export const DESK_FIXTURE_MARKER: string = scenario.marker;

function buildSession(spec: FixtureSession, index: number, now: number, viewOnly = false): Session {
    const request = spec.request;
    return {
        id: spec.id,
        seq: 1,
        createdAt: now - 3_600_000,
        updatedAt: now - index * 1000,
        active: spec.active,
        activeAt: now,
        // Use the real interaction grants to keep demo composers and mode changes inert. Pending
        // requests stay visible; their response controls are disabled by the disconnected socket.
        ...(viewOnly ? { accessLevel: 'view' as const, canApprovePermissions: Boolean(request) } : {}),
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
                  requests: { [`${spec.id}-r1`]: { tool: request.tool, ...(request.kind ? { kind: request.kind } : {}), arguments: request.arguments, createdAt: now - 30_000 } },
              } as unknown as Session['agentState'])
            : null,
        agentStateVersion: 1,
        thinking: Boolean(spec.thinking),
        thinkingAt: spec.thinking ? now : 0,
        presence: 'online',
    };
}

/**
 * Seeds sessions and the coordinator for this device, plus demo transcripts through the sync store
 * owner, then "ready". `now` stamps every record, so a frozen clock gives the same desk each run.
 *
 * Nothing here is persisted: the coordinator is an in-memory override, not the stored choice. The sessions
 * are in the store, though, and the store feeds an account's warm cache once someone signs in, so the caller
 * must call the returned `release` when it stops showing the desk. It deletes only the fixture's sessions and
 * puts readiness back as it was.
 */
export function applyDeskFixture(now: number = Date.now(), data?: string): () => void {
    if (resolveWarmCacheAccountScope(storage.getState().profile.id)) {
        throw new Error('Desk fixture cannot run with an account');
    }
    releaseDeskFixture();
    const selected: FixtureScenario = data === 'demo' ? demo : scenario;
    const specs = selected.sessions;
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
        setCoordinatorOverride(selected.coordinatorId);
        storage.getState().applySessions(specs.map((spec, index) => buildSession(spec, index, now, data === 'demo')));
        if (data === 'demo') {
            for (const spec of specs) {
                const lines = spec.id === selected.coordinatorId ? selected.coordinatorBody.transcript : spec.transcript ?? [];
                const messages = lines.map((line, index): NormalizedMessage => {
                    const id = `${spec.id}-m${index + 1}`;
                    const common = { id, seq: index + 1, localId: null, createdAt: now - (line.ageMs ?? 0), isSidechain: false };
                    return line.from === 'you'
                        ? { ...common, role: 'user', content: { type: 'text', text: line.text } }
                        : { ...common, role: 'agent', content: [{ type: 'text', text: line.text, uuid: id, parentUUID: null }] };
                });
                // The sync layer calls this same owner with normalized messages. It reduces the transcript
                // and pending requests into the real store projections; no separate demo transcript store.
                storage.getState().applyMessages(spec.id, messages);
                storage.getState().applyMessagesLoaded(spec.id);
            }
        }
        storage.getState().applyReady();
    } catch (error) {
        release();
        throw error;
    }
    return release;
}
