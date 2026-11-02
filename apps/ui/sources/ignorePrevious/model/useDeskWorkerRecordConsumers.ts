import { useEffect, useRef } from 'react';
import { useActiveServerSnapshot } from '@/hooks/server/useActiveServerSnapshot';
import { registerSessionRealtimeRecordConsumer } from '@/sync/runtime/sessionRealtimeRecordConsumers';

type WorkerRow = Readonly<{ id: string; archivedAt?: number | null }>;

/** One registration owner per mounted desk, independent of cards and transcript visibility. */
export function useDeskWorkerRecordConsumers(rows: readonly WorkerRow[], coordinatorId: string | null): void {
    const { serverId } = useActiveServerSnapshot();
    const registrations = useRef(new Map<string, () => void>());
    useEffect(() => {
        const mounted = registrations.current;
        return () => {
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
            if (!registrations.current.has(id)) registrations.current.set(id, registerSessionRealtimeRecordConsumer(id, serverId));
        }
    }, [rows, coordinatorId, serverId]);
}
