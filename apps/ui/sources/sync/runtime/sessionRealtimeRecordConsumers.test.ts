import { describe, expect, it, vi } from 'vitest';
import {
    readMountedSessionRealtimeRecordConsumerSessionIds,
    hasSessionRealtimeRecordConsumer,
    clearMountedSessionRealtimeRecordConsumers,
    registerSessionRealtimeRecordConsumer,
    subscribeSessionRealtimeRecordConsumers,
} from './sessionRealtimeRecordConsumers';
import { setServerProfileIdentityForUrl, upsertServerProfile } from '@/sync/domains/server/serverProfiles';
import { resolveSessionLiveConsumption } from './sessionLiveConsumption';
import { enableSessionRealtimeTranscriptSuppression, clearSessionRealtimeTranscriptSuppression } from './sessionRealtimeTranscriptSuppression';

describe('record-only realtime consumers', () => {
    it('F3 looks up one session across equivalent server identifiers and refcounted releases', () => {
        const serverId = upsertServerProfile({ serverUrl: 'http://localhost:53289' }).id;
        setServerProfileIdentityForUrl('http://localhost:53289', 'srv_record_lookup');
        const first = registerSessionRealtimeRecordConsumer('lookup-worker', serverId);
        const second = registerSessionRealtimeRecordConsumer('lookup-worker', serverId);
        try {
            expect(hasSessionRealtimeRecordConsumer('lookup-worker', 'srv_record_lookup')).toBe(true);
            expect(hasSessionRealtimeRecordConsumer('lookup-worker', 'unrelated-server')).toBe(false);
            expect(hasSessionRealtimeRecordConsumer('missing', serverId)).toBe(false);
            expect(hasSessionRealtimeRecordConsumer('lookup-worker')).toBe(true);
            first();
            expect(hasSessionRealtimeRecordConsumer('lookup-worker', serverId)).toBe(true);
            second();
            expect(hasSessionRealtimeRecordConsumer('lookup-worker', serverId)).toBe(false);
        } finally { first(); second(); }
    });

    it('F8 clears test registrations without removing change listeners', () => {
        const release = registerSessionRealtimeRecordConsumer('clear-worker', 'server-a');
        const listener = vi.fn();
        const unsubscribe = subscribeSessionRealtimeRecordConsumers(listener);
        try {
            clearMountedSessionRealtimeRecordConsumers();
            expect(readMountedSessionRealtimeRecordConsumerSessionIds()).toEqual([]);
            release();
            expect(listener).not.toHaveBeenCalled();
            const next = registerSessionRealtimeRecordConsumer('next-worker', 'server-a');
            expect(listener).toHaveBeenCalledTimes(1);
            next();
        } finally { release(); unsubscribe(); clearMountedSessionRealtimeRecordConsumers(); }
    });

    it('refcounts registrations, scopes them to servers, and notifies changes and idempotent releases', () => {
        const listener = vi.fn();
        const unsubscribe = subscribeSessionRealtimeRecordConsumers(listener);
        const first = registerSessionRealtimeRecordConsumer('record-worker', 'server-a');
        const second = registerSessionRealtimeRecordConsumer('record-worker', 'server-a');
        const other = registerSessionRealtimeRecordConsumer('record-worker', 'server-b');
        try {
            expect(readMountedSessionRealtimeRecordConsumerSessionIds('server-a')).toEqual(['record-worker']);
            expect(readMountedSessionRealtimeRecordConsumerSessionIds('server-c')).toEqual([]);
            expect(resolveSessionLiveConsumption('record-worker', 'server-a')).toMatchObject({ isRecordConsumer: true, isFullContentConsumer: false });
            expect(resolveSessionLiveConsumption('record-worker', 'server-c')).toMatchObject({ isRecordConsumer: false });
            first();
            expect(readMountedSessionRealtimeRecordConsumerSessionIds('server-a')).toEqual(['record-worker']);
            second();
            expect(readMountedSessionRealtimeRecordConsumerSessionIds('server-a')).toEqual([]);
            expect(readMountedSessionRealtimeRecordConsumerSessionIds('server-b')).toEqual(['record-worker']);
            const calls = listener.mock.calls.length;
            second();
            expect(listener).toHaveBeenCalledTimes(calls);
            expect(calls).toBe(5);
        } finally {
            first(); second(); other(); unsubscribe();
        }
    });

    it('fails closed under the canonical suppression gate', () => {
        const release = registerSessionRealtimeRecordConsumer('suppressed-record', 'server-a');
        enableSessionRealtimeTranscriptSuppression({ sessionId: 'suppressed-record', sourceServerId: 'server-a' }, { isDevOrTest: true });
        try {
            expect(resolveSessionLiveConsumption('suppressed-record', 'server-a')).toMatchObject({ isRecordConsumer: false, isFullContentConsumer: false });
        } finally {
            clearSessionRealtimeTranscriptSuppression(undefined, { isDevOrTest: true });
            release();
        }
    });
});
