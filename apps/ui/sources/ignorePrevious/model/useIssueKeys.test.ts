import { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { renderHook, standardCleanup } from '@/dev/testkit';
import { createSessionFixture } from '@/dev/testkit/fixtures/sessionFixtures';
import { buildSessionListRenderableFromSession } from '@/sync/domains/session/listing/sessionListRenderable';
import { storage } from '@/sync/domains/state/storage';
import type { ScmStatus, Session } from '@/sync/domains/state/storageTypes';

import { useDeskSessions } from '../useDeskSessions';
import { useIssueKeys } from './useIssueKeys';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

type Extra = Readonly<{ title?: string; path?: string; tag?: unknown; version?: number }>;

/**
 * A worker as the first sync holds it. `version` stands for a later server observation: the store
 * drops a record whose seq, updatedAt and metadataVersion are not newer, so each one bumps all three.
 */
function worker(id: string, { title = 'Fix the login form', path = '/w/plain', tag, version = 1 }: Extra = {}): Session {
    return createSessionFixture({
        id,
        active: true,
        seq: version,
        updatedAt: 10 + version,
        metadataVersion: version,
        metadata: {
            path,
            host: 'h',
            homeDir: '/w',
            machineId: 'm',
            summary: { text: title, updatedAt: version },
            ...(tag !== undefined ? { tag } : {}),
        } as Session['metadata'],
    });
}

function scm(branch: string): ScmStatus {
    return {
        branch,
        isDirty: false,
        modifiedCount: 0,
        untrackedCount: 0,
        includedCount: 0,
        lastUpdatedAt: 1,
        includedLinesAdded: 0,
        includedLinesRemoved: 0,
        pendingLinesAdded: 0,
        pendingLinesRemoved: 0,
        linesAdded: 0,
        linesRemoved: 0,
        linesChanged: 0,
    };
}

function seed(sessions: Session[]) {
    act(() => {
        storage.getState().applySessions(sessions);
        storage.getState().applyReady();
    });
}

async function renderKeys() {
    const seen: Array<string | null | undefined> = [];
    const hook = await renderHook(() => {
        const keys = useIssueKeys(useDeskSessions());
        seen.push(keys.get('w1'));
        return keys;
    });
    return { hook, seen };
}

function dedupe<T>(values: readonly T[]): T[] {
    return values.filter((value, i) => i === 0 || value !== values[i - 1]);
}

describe('useIssueKeys', () => {
    let previous: ReturnType<typeof storage.getState>;
    beforeEach(() => {
        previous = storage.getState();
    });
    afterEach(() => {
        standardCleanup();
        storage.setState(previous, true);
    });

    it('N2 a tag arriving after first render moves the row once', async () => {
        seed([worker('w1')]);
        const { hook, seen } = await renderKeys();
        expect(hook.getCurrent().get('w1')).toBeNull();
        await act(async () => {
            storage.getState().applySessions([worker('w1', { tag: 'ATR-6-build', version: 2 })]);
        });
        expect(dedupe(seen)).toEqual([null, 'ATR-6']);
    });

    it('A4 a tag on a full record that loads after its list row moves the worker', async () => {
        // Cold load: the sidebar's row arrives first, and it carries no tag.
        act(() => {
            storage.getState().mergeSessionListRenderables([buildSessionListRenderableFromSession(worker('w1'))]);
            storage.getState().applyReady();
        });
        const { hook } = await renderKeys();
        expect(hook.getCurrent().get('w1')).toBeNull();
        const row = storage.getState().sessionListRenderables.w1;

        await act(async () => {
            storage.getState().applySessions([worker('w1', { tag: 'ATR-6-build' })]);
        });
        // Only the full record changed, not the row, so the key has to follow the record.
        expect(storage.getState().sessionListRenderables.w1).toBe(row);
        expect(hook.getCurrent().get('w1')).toBe('ATR-6');
    });

    it.each(['title', 'branch', 'folder'] as const)('N2: unloaded metadata must not flash a weaker %s match', async (source) => {
        const full = worker('w1', {
            tag: 'ATR-6-build',
            title: source === 'title' ? 'ATR-7 other' : 'Worker',
            path: source === 'folder' ? '/work/atr-9-other' : '/work/repo',
        });
        act(() => {
            storage.getState().mergeSessionListRenderables([buildSessionListRenderableFromSession(full)]);
            if (source === 'branch') storage.getState().applyScmStatus('w1', scm('atr-8-other'));
            storage.getState().applyReady();
        });
        const { hook, seen } = await renderKeys();
        expect(hook.getCurrent().get('w1')).toBeNull();
        await act(async () => { storage.getState().applySessions([full]); });
        expect(dedupe(seen)).toEqual([null, 'ATR-6']);
    });

    it('N2: a full record behind the list metadata version must wait for the tag', async () => {
        seed([worker('w1', { title: 'Worker' })]);
        const newer = worker('w1', { title: 'ATR-7 other', tag: 'ATR-6-review', version: 2 });
        act(() => {
            storage.getState().mergeSessionListRenderables([buildSessionListRenderableFromSession(newer)]);
        });
        const { hook, seen } = await renderKeys();
        expect(hook.getCurrent().get('w1')).toBeNull();
        await act(async () => { storage.getState().applySessions([newer]); });
        expect(dedupe(seen)).toEqual([null, 'ATR-6']);
    });

    it('N2: current metadata without a tag restores the fallback after hydration', async () => {
        const full = worker('w1', { title: 'ATR-7 tidy' });
        act(() => {
            storage.getState().mergeSessionListRenderables([buildSessionListRenderableFromSession(full)]);
            storage.getState().applyReady();
        });
        const { hook } = await renderKeys();
        expect(hook.getCurrent().get('w1')).toBeNull();
        await act(async () => { storage.getState().applySessions([full]); });
        expect(hook.getCurrent().get('w1')).toBe('ATR-7');
    });

    it('N3 same repo and branch, different tags, two issues', async () => {
        seed([worker('w1', { tag: 'ATR-6-build' }), worker('w2', { tag: 'ATR-7-build' })]);
        act(() => {
            storage.getState().applyScmStatus('w1', scm('main'));
            storage.getState().applyScmStatus('w2', scm('main'));
        });
        const { hook } = await renderKeys();
        expect([hook.getCurrent().get('w1'), hook.getCurrent().get('w2')]).toEqual(['ATR-6', 'ATR-7']);
    });

    it('N8 with a tag, a changed title does not move the worker', async () => {
        seed([worker('w1', { tag: 'ATR-6-build', title: 'ATR-6 build' })]);
        const { hook } = await renderKeys();
        expect(hook.getCurrent().get('w1')).toBe('ATR-6');
        await act(async () => {
            storage.getState().applySessions([worker('w1', { tag: 'ATR-6-build', title: 'ATR-9 other', version: 2 })]);
        });
        // The new title did reach the store, so the key holding is the tag's doing.
        expect(storage.getState().sessions.w1?.metadata?.summary?.text).toBe('ATR-9 other');
        expect(hook.getCurrent().get('w1')).toBe('ATR-6');
    });

    it('N2 no tag falls back to title, then branch, then path', async () => {
        seed([
            worker('w1', { title: 'ATR-7 tidy', path: '/w/atr-9-x' }),
            worker('w2', { path: '/w/atr-9-x' }),
            worker('w3', { path: '/w/atr-9-x' }),
        ]);
        act(() => {
            storage.getState().applyScmStatus('w1', scm('atr-8-x'));
            storage.getState().applyScmStatus('w2', scm('atr-8-x'));
        });
        const { hook } = await renderKeys();
        expect(['w1', 'w2', 'w3'].map((id) => hook.getCurrent().get(id))).toEqual(['ATR-7', 'ATR-8', 'ATR-9']);
    });

    it('a non-string tag is absent', async () => {
        seed([worker('w1', { tag: 42 })]);
        act(() => {
            storage.getState().applyScmStatus('w1', scm('atr-8-x'));
        });
        const { hook } = await renderKeys();
        expect(hook.getCurrent().get('w1')).toBe('ATR-8');
    });

    it('must not key a session the desk does not list', async () => {
        seed([worker('w1', { tag: 'ATR-6-build' }), { ...worker('w2', { tag: 'ATR-7-build' }), archivedAt: 5 } as Session]);
        const { hook } = await renderKeys();
        expect([...hook.getCurrent().keys()]).toEqual(['w1']);
    });
});
