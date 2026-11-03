import * as React from 'react';
import { useIsFocused } from '@react-navigation/native';

import { decodeBase64 } from '@/encryption/base64';
import { sessionReadFile } from '@/sync/ops/sessionFileSystem/fileReadWrite';
import { useSocketStatus } from '@/sync/store/hooks';
import { isHostVisible, isRuntimeActive } from '@/utils/runtime/isRuntimeActive';

import type { DeskSessions } from '../useDeskSessions';
import { COORDINATOR_PATH } from './useCoordinatorId';
import { useIssueKeys } from './useIssueKeys';
import { parseWqItem, parseWqProjects, wqDirectory, wqItemPath, type WqItem, type WqProjects } from './wqCardData';

/** Lead-approved freshness window, including failures. No disk persistence or separate timer. */
const REFRESH_MS = 5 * 60_000;

type CardCache = {
    coordinatorId: string | null;
    dir: string | null;
    alive: boolean;
    projects: WqProjects | null;
    projectsAttemptAt: number | null;
    items: Map<string, WqItem | null>;
    attempts: Map<string, number>;
};

// One selection survives Work panel remounts. A replaced entry cannot publish a late result.
let currentCache: CardCache | null = null;
let revision = 0;
let busy = false;
const listeners = new Set<() => void>();
const pumps = new Set<() => void>();
const emptyItems: ReadonlyMap<string, WqItem | null> = new Map();
const getRevision = () => revision;
function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}
function changed(): void {
    revision++;
    for (const listener of listeners) listener();
}
function matches(cache: CardCache | null, coordinatorId: string | null, dir: string | null): boolean {
    return cache !== null && cache.coordinatorId === coordinatorId && cache.dir === dir;
}
function selectCache(coordinatorId: string | null, dir: string | null): CardCache {
    if (currentCache && matches(currentCache, coordinatorId, dir)) return currentCache;
    if (currentCache) currentCache.alive = false;
    currentCache = {
        coordinatorId, dir, alive: true, projects: null, projectsAttemptAt: null, items: new Map(), attempts: new Map(),
    };
    changed();
    return currentCache;
}

/** Test isolation only. Any outstanding boundary call still owns the global read lock. */
export function resetWorkCardCacheForTests(): void {
    if (currentCache) currentCache.alive = false;
    currentCache = null;
}

export type WorkCardData = Readonly<{
    issueKeys: ReadonlyMap<string, string | null>;
    knownProjectCodes: ReadonlySet<string> | undefined;
    items: ReadonlyMap<string, WqItem | null>;
    projectNames: ReadonlyMap<string, string> | undefined;
}>;

/** The read response is base64. Neither the encoded file nor its decoded body enters state. */
async function readProjection<T>(coordinatorId: string, path: string, parse: (text: string) => T | null): Promise<T | null> {
    try {
        const result = await sessionReadFile(coordinatorId, path);
        return result.success ? parse(new TextDecoder('utf-8', { fatal: true }).decode(decodeBase64(result.content))) : null;
    } catch {
        // The specified quiet fallback includes transport, size, decoding and parse failures.
        // Never log the response or exception: either may contain file content or paths.
        return null;
    }
}

/** Read only the existing projection for the selected coordinator; never initiate a row read. */
export function useQuestionContextData(coordinatorId: string | undefined) {
    React.useSyncExternalStore(subscribe, getRevision, getRevision);
    const dir = wqDirectory(process.env.EXPO_PUBLIC_IP_WQ_DIR, COORDINATOR_PATH);
    const cache = coordinatorId && matches(currentCache, coordinatorId, dir) ? currentCache : null;
    return cache ? { items: cache.items, projectNames: cache.projects?.names } : null;
}

/** Owns the desk's optional wq projection and its known-project issue resolution. */
export function useWorkCardData(coordinatorId: string | null, workers: DeskSessions, nowMs: number): WorkCardData {
    const dir = wqDirectory(process.env.EXPO_PUBLIC_IP_WQ_DIR, COORDINATOR_PATH);
    const focused = useIsFocused();
    const connected = useSocketStatus().status === 'connected';
    const revision = React.useSyncExternalStore(subscribe, getRevision, getRevision);
    const cache = matches(currentCache, coordinatorId, dir) ? currentCache : null;
    const knownProjectCodes = cache?.projects?.knownProjectCodes;
    const issueKeys = useIssueKeys(workers, knownProjectCodes);
    const visibleKeys = React.useMemo(() => [...new Set(workers.list.filter(row => !row.archivedAt)
        .map(row => issueKeys.get(row.id)).filter((key): key is string => key != null))].sort(), [workers.list, issueKeys]);
    React.useEffect(() => {
        const cache = selectCache(coordinatorId, dir);
        let active = true;
        const pump = () => {
            if (busy || !active || !cache.alive || !coordinatorId || !dir || !focused || !connected || !isRuntimeActive() || !isHostVisible()) return;
            const now = Date.now();
            let read: Promise<unknown>;
            if (!cache.projects) {
                if (cache.projectsAttemptAt !== null && now - cache.projectsAttemptAt < REFRESH_MS) return;
                cache.projectsAttemptAt = now;
                busy = true;
                read = readProjection(coordinatorId, `${dir.replace(/\/$/, '')}/projects.json`, parseWqProjects).then(projects => {
                    if (cache.alive) { cache.projects = projects; changed(); }
                });
            } else {
                const codes = cache.projects.knownProjectCodes;
                const key = visibleKeys.find(key => wqItemPath(dir, key, codes) !== null &&
                    (!cache.attempts.has(key) || now - cache.attempts.get(key)! >= REFRESH_MS));
                if (!key) return;
                const path = wqItemPath(dir, key, codes)!;
                cache.attempts.set(key, now);
                busy = true;
                read = readProjection(coordinatorId, path, text => parseWqItem(text, key)).then(item => {
                    if (!cache.alive) return;
                    const previous = cache.items.get(key);
                    if (previous?.id === item?.id && previous?.title === item?.title && previous?.status === item?.status && previous?.pr === item?.pr) return;
                    cache.items.set(key, item);
                    changed();
                });
            }
            void read.finally(() => {
                busy = false;
                // Only mounted hooks can start more work, using their current keys and gates.
                for (const pump of pumps) pump();
            });
        };
        pumps.add(pump);
        pump();
        return () => { active = false; pumps.delete(pump); };
    }, [coordinatorId, dir, focused, connected, visibleKeys, nowMs, revision]);

    return { issueKeys, knownProjectCodes, items: cache?.items ?? emptyItems, projectNames: cache?.projects?.names };
}
