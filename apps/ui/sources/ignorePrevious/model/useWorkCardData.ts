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
    alive: boolean;
    projects: WqProjects | null;
    projectsAttemptAt: number | null;
    items: Map<string, WqItem | null>;
    attempts: Map<string, number>;
};

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

/** Owns the desk's optional wq projection and its known-project issue resolution. */
export function useWorkCardData(coordinatorId: string | null, workers: DeskSessions, nowMs: number): WorkCardData {
    const dir = wqDirectory(process.env.EXPO_PUBLIC_IP_WQ_DIR, COORDINATOR_PATH);
    const focused = useIsFocused();
    const connected = useSocketStatus().status === 'connected';
    const [revision, changed] = React.useReducer((n: number) => n + 1, 0);
    const cache = React.useMemo<CardCache>(() => ({
        alive: false, projects: null, projectsAttemptAt: null, items: new Map(), attempts: new Map(),
    }), [coordinatorId, dir]);
    const knownProjectCodes = cache.projects?.knownProjectCodes;
    const issueKeys = useIssueKeys(workers, knownProjectCodes);
    const visibleKeys = React.useMemo(() => [...new Set([...issueKeys.values()].filter((key): key is string => key !== null))].sort(), [issueKeys]);
    // One outstanding boundary call across key changes AND coordinator/directory changes.
    const busy = React.useRef(false);
    const pumpCurrent = React.useRef<() => void>(() => {});

    React.useEffect(() => {
        cache.alive = true;
        return () => { cache.alive = false; };
    }, [cache]);

    React.useEffect(() => {
        let active = true;
        const pump = () => {
            if (busy.current || !active || !cache.alive || !coordinatorId || !dir || !focused || !connected || !isRuntimeActive() || !isHostVisible()) return;
            const now = Date.now();
            let read: Promise<unknown>;
            if (!cache.projects) {
                if (cache.projectsAttemptAt !== null && now - cache.projectsAttemptAt < REFRESH_MS) return;
                cache.projectsAttemptAt = now;
                busy.current = true;
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
                busy.current = true;
                read = readProjection(coordinatorId, path, text => parseWqItem(text, key)).then(item => {
                    if (!cache.alive) return;
                    const previous = cache.items.get(key);
                    if (previous?.id === item?.id && previous?.title === item?.title && previous?.status === item?.status && previous?.pr === item?.pr) return;
                    cache.items.set(key, item);
                    changed();
                });
            }
            void read.finally(() => {
                busy.current = false;
                pumpCurrent.current();
            });
        };
        pumpCurrent.current = pump;
        pump();
        return () => { active = false; };
    }, [cache, coordinatorId, dir, focused, connected, visibleKeys, nowMs, revision]);

    return { issueKeys, knownProjectCodes, items: cache.items, projectNames: cache.projects?.names };
}
