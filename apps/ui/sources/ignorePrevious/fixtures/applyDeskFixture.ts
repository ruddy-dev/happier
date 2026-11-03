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
import { demoScript, mountDemoConversation } from './demoConversation';

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
    const linesFor = (spec: FixtureSession) => spec.id === selected.coordinatorId ? selected.coordinatorBody.transcript : spec.transcript ?? [];
    const applyLines = (spec: FixtureSession, count: number) => {
        const messages = linesFor(spec).slice(0, count).map((line, index): NormalizedMessage => {
            const id = `${spec.id}-m${index + 1}`;
            const common = { id, seq: index + 1, localId: null, createdAt: now - (line.ageMs ?? 0), isSidechain: false };
            return line.from === 'you'
                ? { ...common, role: 'user', content: { type: 'text', text: line.text } }
                : { ...common, role: 'agent', content: [{ type: 'text', text: line.text, uuid: id, parentUUID: null }] };
        });
        // The same normalized-message owner as sync; empty transcripts still become loaded.
        storage.getState().applyMessages(spec.id, messages);
        storage.getState().applyMessagesLoaded(spec.id);
    };
    const applyDemoProgress = (step: number, reset: boolean) => {
        const complete = step === demoScript.length;
        // Restart removes reducer history. Completion also drops transient runtime/grace fields,
        // so the final fixture is exactly the static demo, independent of the playback clock.
        if (reset || complete) storage.getState().deleteSessions(specs.map(spec => spec.id));
        const visible = demoScript.slice(0, step);
        const changedId = demoScript[step - 1]?.sessionId;
        const changed = specs.flatMap((spec, index) => {
            if (!reset && !complete && spec.id !== changedId) return [];
            const count = visible.filter(event => event.sessionId === spec.id).length;
            const finished = count === linesFor(spec).length;
            const progressSpec = complete || finished ? spec : {
                ...spec,
                active: spec.id === selected.coordinatorId || count > 0,
                thinking: count > 0,
                request: undefined,
            };
            return [{ spec, count, session: buildSession(progressSpec, index, now, true) }];
        });
        storage.getState().applySessions(changed.map(row => row.session));
        for (const row of changed) applyLines(row.spec, row.count);
    };
    const player = data === 'demo' ? mountDemoConversation(applyDemoProgress) : null;
    let released = false;
    const release = () => {
        if (released) return;
        released = true;
        player?.release();
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
            for (const spec of specs) applyLines(spec, linesFor(spec).length);
        }
        storage.getState().applyReady();
    } catch (error) {
        release();
        throw error;
    }
    return release;
}
