import { useEffect, useRef } from 'react';
import { useActiveServerSnapshot } from '@/hooks/server/useActiveServerSnapshot';
import { hasSessionRealtimeRecordConsumer, registerSessionRealtimeRecordConsumer } from '@/sync/runtime/sessionRealtimeRecordConsumers';
import { storage } from '@/sync/domains/state/storage';
import { forgetWorkerPermissionOutcome, retainWorkerPermissionOutcome } from './workerPermissionOutcome';

type WorkerRow = Readonly<{ id: string; archivedAt?: number | null }>;

/** One registration owner per mounted desk, independent of cards and transcript visibility. */
export function useDeskWorkerRecordConsumers(rows: readonly WorkerRow[], coordinatorId: string | null): void {
    const { serverId } = useActiveServerSnapshot();
    const registrations = useRef(new Map<string, () => void>());
    useEffect(() => {
        const mounted = registrations.current;
        const unsubscribe = storage.subscribe((state, previous) => {
            if (state.sessions === previous.sessions) return;
            for (const id of mounted.keys()) {
                if (state.sessions[id]?.metadata?.permissionMode !== previous.sessions[id]?.metadata?.permissionMode) {
                    retainWorkerPermissionOutcome(id, serverId);
                }
            }
        });
        return () => {
            unsubscribe();
            for (const release of mounted.values()) release();
            mounted.clear();
        };
    }, [serverId]);
    useEffect(() => {
        const wanted = new Set(rows.filter(row => row.id !== coordinatorId && !row.archivedAt).map(row => row.id));
        for (const [id, release] of registrations.current) {
            if (!wanted.has(id)) {
                release();
                registrations.current.delete(id);
            }
        }
        for (const id of wanted) {
            if (!registrations.current.has(id)) {
                const release = registerSessionRealtimeRecordConsumer(id, serverId);
                retainWorkerPermissionOutcome(id, serverId);
                registrations.current.set(id, () => {
                    release();
                    if (!hasSessionRealtimeRecordConsumer(id, serverId)) forgetWorkerPermissionOutcome(id, serverId);
                });
            }
        }
    }, [rows, coordinatorId, serverId]);
}
