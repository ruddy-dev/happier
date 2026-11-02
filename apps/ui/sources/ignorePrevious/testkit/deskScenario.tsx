import * as React from 'react';
import { act, type ReactTestInstance } from 'react-test-renderer';
import { vi } from 'vitest';

import { AppPaneProvider } from '@/components/appShell/panes/AppPaneProvider';
import { renderScreen } from '@/dev/testkit';
import { standardCleanup } from '@/dev/testkit/cleanup/standardCleanup';
import { createSessionFixture } from '@/dev/testkit/fixtures/sessionFixtures';
import { flushHookEffects } from '@/dev/testkit/hooks/flushHookEffects';
import { buildSessionListRenderableFromSession } from '@/sync/domains/session/listing/sessionListRenderable';
import { storage } from '@/sync/domains/state/storage';
import type { Session } from '@/sync/domains/state/storageTypes';

import {
    getApprovalsOpen,
    getStoredCoordinatorId,
    getWorkCollapsed,
    setApprovalsOpen,
    setStoredCoordinatorId,
    setWorkCollapsed,
} from '../deskPrefs';
import { DeskScreen } from '../screens/DeskScreen';
import { DeskScriptSchema, type DeskPatch, type DeskScript, type DeskStep } from './scripts/deskScript.schema';

export type { DeskPatch, DeskRequest, DeskScript, DeskScriptSession, DeskStep } from './scripts/deskScript.schema';

/** 1 Nov 2026, 09:00 UTC. A fixed start keeps every run's clock identical. */
const DEFAULT_T0 = Date.UTC(2026, 10, 1, 9, 0, 0);

type RenderedScreen = Awaited<ReturnType<typeof renderScreen>>;
type AgentState = NonNullable<Session['agentState']>;

export type DeskScenarioOptions = Readonly<{
    script: DeskScript;
    /** Stored as this device's coordinator choice; omitted means none is stored. */
    coordinator?: string;
    /** False leaves the store before its first sync; `ready()` finishes it. */
    dataReady?: boolean;
    uiMultiPanePanelsEnabled?: boolean;
}>;

export type DeskScenario = Readonly<{
    screen: RenderedScreen;
    /** Moves the fake clock on, applying each script step when its time comes. */
    advance: (ms: number) => Promise<void>;
    /** Applies a patch now. `late` makes it an echo older than what the store holds. */
    apply: (id: string, patch: DeskPatch, options?: Readonly<{ late?: boolean }>) => Promise<void>;
    /** The first sync finishes (`applyReady`). */
    ready: () => Promise<void>;
    openApprovals: () => Promise<void>;
    /** Text inside the element with this testID, or null when it isn't rendered. */
    textOf: (testID: string) => string | null;
    dispose: () => Promise<void>;
}>;

/** Validates a script; the error names each bad field by its path. */
export function loadDeskScript(raw: unknown): DeskScript {
    const parsed = DeskScriptSchema.safeParse(raw);
    if (parsed.success) return parsed.data;
    const problems = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
    throw new Error(`Bad desk script: ${problems.join('; ')}`);
}

type Stamp = 'initial' | 'fresh' | 'late';

const TIME_FIELDS = [
    'activeAt',
    'thinkingAt',
    'updatedAt',
    'createdAt',
    'pendingRequestObservedAt',
    'latestTurnStatusObservedAt',
] as const;

/**
 * Applies a script patch to a session record and stamps it the way a server observation would be.
 * The store keeps the newest observation of each part of a session (`reconcileSessionSnapshot`), so
 * a fresh patch must carry newer seq and versions than the record it replaces, and a late one older.
 */
function patchSession(session: Session, patch: DeskPatch, stamp: Stamp, t0: number, now: number): Session {
    const next: Session = { ...session };
    const touchesRequests = patch.requests !== undefined || patch.completed !== undefined;
    const touchesMetadata = patch.metadata !== undefined;

    if (patch.active !== undefined) {
        next.active = patch.active;
        if (stamp !== 'late') next.activeAt = now;
    }
    if (patch.thinking !== undefined) {
        next.thinking = patch.thinking;
        if (stamp !== 'late') next.thinkingAt = now;
    }
    if (patch.pendingPermissionRequestCount !== undefined) next.pendingPermissionRequestCount = patch.pendingPermissionRequestCount;
    if (patch.pendingUserActionRequestCount !== undefined) next.pendingUserActionRequestCount = patch.pendingUserActionRequestCount;
    if (patch.archivedAt !== undefined) next.archivedAt = patch.archivedAt === null ? null : t0 + patch.archivedAt;
    if (touchesMetadata) next.metadata = { ...session.metadata, ...patch.metadata } as Session['metadata'];
    if (touchesRequests) next.agentState = patchAgentState(session.agentState, patch, t0, now);

    if (stamp === 'fresh') {
        next.seq = session.seq + 1;
        next.updatedAt = Math.max(session.updatedAt, now);
        if (touchesMetadata) next.metadataVersion = session.metadataVersion + 1;
        if (touchesRequests) {
            next.agentStateVersion = session.agentStateVersion + 1;
            next.pendingRequestObservedAt = now;
        }
    } else if (stamp === 'late') {
        // Strictly older on every ordering field the patch touches; equal values would tie and be taken.
        next.seq = session.seq - 1;
        if (patch.active !== undefined) next.activeAt = session.activeAt - 1;
        if (patch.thinking !== undefined) next.thinkingAt = session.thinkingAt - 1;
        if (touchesMetadata) next.metadataVersion = session.metadataVersion - 1;
        if (touchesRequests) {
            next.agentStateVersion = session.agentStateVersion - 1;
            next.pendingRequestObservedAt = (session.pendingRequestObservedAt ?? now) - 1;
        }
    } else if (touchesRequests) {
        next.pendingRequestObservedAt = now;
    }

    // Explicit times in the script win over stamping.
    for (const field of TIME_FIELDS) {
        const value = patch[field];
        if (value !== undefined) next[field] = t0 + value;
    }
    return next;
}

function patchAgentState(state: Session['agentState'], patch: DeskPatch, t0: number, now: number): AgentState {
    const requests = { ...state?.requests };
    const completedRequests = { ...state?.completedRequests };
    for (const [id, request] of Object.entries(patch.requests ?? {})) {
        if (request === null) {
            delete requests[id];
            continue;
        }
        requests[id] = {
            tool: request.tool,
            arguments: request.arguments ?? {},
            ...(request.kind !== undefined ? { kind: request.kind } : {}),
            createdAt: request.createdAt !== undefined ? t0 + request.createdAt : now,
        };
    }
    for (const [id, status] of Object.entries(patch.completed ?? {})) {
        const request = requests[id];
        if (!request) continue;
        delete requests[id];
        completedRequests[id] = { ...request, status, completedAt: now };
    }
    return { ...state, requests, completedRequests } as AgentState;
}

/** A session as the sync layer would hold it after decrypting the server's record. */
function createScriptSession(
    spec: DeskScript['sessions'][number],
    t0: number,
): Session {
    const base = createSessionFixture({
        id: spec.id,
        createdAt: t0,
        updatedAt: t0,
        activeAt: t0,
        metadata: {
            path: spec.path,
            host: 'desk-test',
            homeDir: '/work',
            machineId: 'desk-test-machine',
            summary: { text: spec.title, updatedAt: t0 },
        } as Session['metadata'],
    });
    return spec.initial ? patchSession(base, spec.initial, 'initial', t0, t0) : base;
}

/** Text of every string under an element, joined; numbers are rendered as strings by then. */
function collectText(node: ReactTestInstance | string): string {
    if (typeof node === 'string') return node;
    return node.children.map(collectText).join('');
}

/**
 * Renders the real DeskScreen over the real session store, seeded from a script, under a fake clock.
 * Test files keep their own `vi.mock` calls for the boundaries (see `deskScreenMocks`), including
 * `@react-navigation/native` through the testkit's `createReactNavigationNativeMock`: the desk clock reads focus.
 */
export async function startDeskScenario(options: DeskScenarioOptions): Promise<DeskScenario> {
    const { script } = options;
    const t0 = script.t0 ?? DEFAULT_T0;
    vi.useFakeTimers();
    vi.setSystemTime(t0);

    const previousState = storage.getState();
    const previousPrefs = {
        coordinator: getStoredCoordinatorId(),
        approvalsOpen: getApprovalsOpen(),
        workCollapsed: getWorkCollapsed(),
    };
    const previousMultiPane = previousState.localSettings.uiMultiPanePanelsEnabled;

    // Sessions known only as list rows until a `hydrate` step loads their full record.
    const listOnly = new Map<string, Session>();
    const full: Session[] = [];
    for (const spec of script.sessions) {
        const session = createScriptSession(spec, t0);
        if (spec.listOnly) listOnly.set(spec.id, session);
        else full.push(session);
    }

    act(() => {
        const state = storage.getState();
        state.setSocketStatus('connected');
        if (options.dataReady !== false) state.setLastSyncAt(t0);
        if (full.length > 0) state.applySessions(full);
        if (listOnly.size > 0) {
            state.mergeSessionListRenderables([...listOnly.values()].map((session) => buildSessionListRenderableFromSession(session)));
        }
        if (options.uiMultiPanePanelsEnabled !== undefined) {
            state.applyLocalSettings({ uiMultiPanePanelsEnabled: options.uiMultiPanePanelsEnabled });
        }
        if (options.dataReady === false) storage.setState({ isDataReady: false });
        else state.applyReady();
    });
    setStoredCoordinatorId(options.coordinator ?? null);
    setApprovalsOpen(false);
    setWorkCollapsed(false);

    function Panes({ children }: { children?: React.ReactNode }) {
        return <AppPaneProvider>{children}</AppPaneProvider>;
    }
    const screen = await renderScreen(<DeskScreen />, { wrapper: Panes });
    await flushHookEffects();

    const steps = [...script.steps].sort((a, b) => a.at - b.at);
    let nextStep = 0;

    function applyNow(id: string, patch: DeskPatch | undefined, stamp: Stamp, hydrate = false): void {
        const now = Date.now();
        const virtual = listOnly.get(id);
        const current = virtual ?? storage.getState().sessions[id];
        if (!current) throw new Error(`deskScenario: no session ${id}`);
        const next = patch ? patchSession(current, patch, stamp, t0, now) : current;
        act(() => {
            if (virtual && !hydrate) {
                listOnly.set(id, next);
                storage.getState().mergeSessionListRenderables([buildSessionListRenderableFromSession(next)]);
                return;
            }
            listOnly.delete(id);
            storage.getState().applySessions([next]);
        });
    }

    function runStep(step: DeskStep): void {
        applyNow(step.id, step.patch, step.late ? 'late' : 'fresh', step.hydrate === true);
    }

    function moveClock(ms: number): void {
        if (ms > 0) act(() => {
            vi.advanceTimersByTime(ms);
        });
    }

    return {
        screen,
        advance: async (ms) => {
            const target = Date.now() + ms;
            while (nextStep < steps.length && t0 + steps[nextStep]!.at <= target) {
                const step = steps[nextStep]!;
                nextStep += 1;
                moveClock(t0 + step.at - Date.now());
                runStep(step);
            }
            moveClock(target - Date.now());
            await flushHookEffects();
        },
        apply: async (id, patch, applyOptions) => {
            applyNow(id, patch, applyOptions?.late ? 'late' : 'fresh');
            await flushHookEffects();
        },
        ready: async () => {
            act(() => {
                storage.getState().applyReady();
            });
            await flushHookEffects();
        },
        openApprovals: async () => {
            await screen.pressByTestIdAsync('ip-approvals-open');
            await flushHookEffects();
        },
        textOf: (testID) => {
            const node = screen.findByTestId(testID);
            return node ? collectText(node) : null;
        },
        dispose: async () => {
            await screen.unmount();
            standardCleanup();
            if (storage.getState().localSettings.uiMultiPanePanelsEnabled !== previousMultiPane) {
                storage.getState().applyLocalSettings({ uiMultiPanePanelsEnabled: previousMultiPane });
            }
            storage.setState(previousState, true);
            setStoredCoordinatorId(previousPrefs.coordinator);
            setApprovalsOpen(previousPrefs.approvalsOpen);
            setWorkCollapsed(previousPrefs.workCollapsed);
            vi.useRealTimers();
        },
    };
}
