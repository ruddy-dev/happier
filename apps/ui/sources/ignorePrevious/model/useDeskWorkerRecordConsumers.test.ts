import { afterEach, describe, expect, it } from 'vitest';
import { renderHook, standardCleanup } from '@/dev/testkit';
import { readMountedSessionRealtimeRecordConsumerSessionIds } from '@/sync/runtime/sessionRealtimeRecordConsumers';
import { useDeskWorkerRecordConsumers } from './useDeskWorkerRecordConsumers';

describe('desk worker record demand', () => {
    afterEach(standardCleanup);
    it('excludes the coordinator and archived workers, reconciles membership, and releases on unmount', async () => {
        const hook = await renderHook(({ rows, coordinatorId }) => useDeskWorkerRecordConsumers(rows, coordinatorId), {
            initialProps: { rows: [{ id: 'worker-a', archivedAt: null }, { id: 'coordinator', archivedAt: null }, { id: 'archived', archivedAt: 1 }], coordinatorId: 'coordinator' },
        });
        expect(readMountedSessionRealtimeRecordConsumerSessionIds()).toEqual(['worker-a']);
        await hook.rerender({ rows: [{ id: 'worker-b', archivedAt: null }, { id: 'coordinator', archivedAt: null }], coordinatorId: 'coordinator' });
        expect(readMountedSessionRealtimeRecordConsumerSessionIds()).toEqual(['worker-b']);
        await hook.unmount();
        expect(readMountedSessionRealtimeRecordConsumerSessionIds()).toEqual([]);
    });
});
