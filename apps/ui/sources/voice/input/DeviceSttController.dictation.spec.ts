import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __emitSpeechRecognitionEvent as emit, __resetExpoSpeechRecognitionStub, __setExpoSpeechRecognitionImpls } from '@/dev/expoSpeechRecognitionStub';
import { createDeviceSttController } from './DeviceSttController';

const permission = vi.hoisted(() => vi.fn(async () => ({ granted: true })));
vi.mock('@/utils/platform/microphonePermissions', () => ({
    requestMicrophonePermission: permission,
    showMicrophonePermissionDeniedAlert: vi.fn(),
}));

beforeEach(() => {
    __resetExpoSpeechRecognitionStub();
    permission.mockReset().mockResolvedValue({ granted: true });
});
afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
});

function setup(dictation = true) {
    const patches: Array<{ status?: string; sessionId?: string | null; error?: string | null }> = [];
    const start = vi.fn();
    const abort = vi.fn();
    __setExpoSpeechRecognitionImpls({ start, abort, stop: () => emit('end') });
    const controller = createDeviceSttController({
        setState: patch => patches.push(patch), getSettings: () => ({}),
        canAutoStopTurn: () => false, onAutoStopTurn: vi.fn(),
        ...(dictation ? { dictation: true } : {}),
    });
    return { controller, patches, start, abort };
}

describe('device dictation lifecycle', () => {
    it('keeps the existing caller state and transcript after a recognizer error', async () => {
        const { controller, patches } = setup(false);
        await controller.start('coordinator');
        emit('result', { results: [{ transcript: 'keep this' }] });
        const before = [...patches];
        emit('error', { error: 'network' });
        expect(patches).toEqual(before);
        expect(patches.at(-1)).toEqual({ status: 'recording', sessionId: 'coordinator', error: null });
        await expect(controller.stop('coordinator')).resolves.toBe('keep this');
    });

    it('still reports recognizer errors to the opted-in dictation caller', async () => {
        const { controller, patches } = setup();
        await controller.start('coordinator');
        emit('error', { error: 'network' });
        expect(patches.at(-1)).toEqual({ status: 'error', sessionId: null, error: 'device_stt_recognition_failed' });
        controller.cancel('coordinator');
    });

    it('does not patch existing caller state on microphone permission denial', async () => {
        permission.mockResolvedValue({ granted: false });
        const { controller, patches, start } = setup(false);
        await controller.start('coordinator');
        expect(patches).toEqual([]);
        expect(start).not.toHaveBeenCalled();
    });

    it('does not abort recognition on start failure for existing callers', async () => {
        const { controller, patches, abort } = setup(false);
        __setExpoSpeechRecognitionImpls({ start: () => { throw new Error('unavailable'); } });
        await expect(controller.start('coordinator')).rejects.toThrow('unavailable');
        expect(abort).not.toHaveBeenCalled();
        expect(patches).toEqual([{ status: 'idle', sessionId: null, error: 'device_stt_start_failed' }]);
    });

    it('does not patch existing caller state when recognizer stop throws', async () => {
        const { controller, patches } = setup(false);
        await controller.start('coordinator');
        emit('result', { results: [{ transcript: 'keep this' }] });
        const before = [...patches];
        __setExpoSpeechRecognitionImpls({ stop: () => { throw new Error('unavailable'); } });
        const stopping = controller.stop('coordinator');
        emit('end');
        await expect(stopping).resolves.toBe('keep this');
        expect(patches).toEqual(before);
    });

    it('does not supersede existing callers overlapping permission requests', async () => {
        const grants: Array<(value: { granted: boolean }) => void> = [];
        permission.mockImplementation(() => new Promise(resolve => { grants.push(resolve); }));
        const { controller, start } = setup(false);
        const first = controller.start('first');
        const second = controller.start('second');
        grants[0]({ granted: true });
        await first;
        grants[1]({ granted: true });
        await second;
        expect(start).toHaveBeenCalledTimes(2);
        await controller.stop('second');
    });

    it('retains existing callers current-handle behavior when a new start finishes during stop', async () => {
        vi.useFakeTimers();
        const { controller } = setup(false);
        await controller.start('first');
        emit('result', { results: [{ transcript: 'first words' }] });
        __setExpoSpeechRecognitionImpls({ stop: () => {} });
        const stopping = controller.stop('first');
        await controller.start('second');
        emit('result', { results: [{ transcript: 'second words' }] });
        emit('end');
        await vi.advanceTimersByTimeAsync(5_000);
        await expect(stopping).resolves.toBe('second words');
        await expect(controller.stop('second')).resolves.toBe('');
    });

    it('reports cancellation failure without logging audio or transcript content', async () => {
        const signal = vi.spyOn(console, 'error').mockImplementation(() => {});
        const { controller, patches } = setup();
        await controller.start('coordinator');
        emit('result', { results: [{ transcript: 'private words' }] });
        __setExpoSpeechRecognitionImpls({ abort: () => { throw new Error('private SDK details'); } });
        controller.cancel('coordinator');
        expect(signal).toHaveBeenCalledExactlyOnceWith('device_stt_cancel_failed');
        expect(patches.at(-1)?.error).toBe('device_stt_cancel_failed');
        await expect(controller.stop('coordinator')).resolves.toBe('');
    });

    it('retains finalized phrases and replaces only the current interim phrase for dictation', async () => {
        const { controller } = setup(true);
        await controller.start('coordinator');
        emit('result', { isFinal: true, results: [{ transcript: 'First phrase.' }] });
        emit('result', { isFinal: false, results: [{ transcript: 'Sec' }] });
        emit('result', { isFinal: false, results: [{ transcript: 'Second' }] });
        emit('result', { isFinal: true, results: [{ transcript: 'Second phrase.' }] });
        emit('result', { isFinal: false, results: [{ transcript: 'Third phrase' }] });
        await expect(controller.stop('coordinator')).resolves.toBe('First phrase. Second phrase. Third phrase');
    });

    it('reports permission denial without recording', async () => {
        permission.mockResolvedValue({ granted: false });
        const { controller, patches, start } = setup();
        await controller.start('coordinator');
        expect(start).not.toHaveBeenCalled();
        expect(patches.at(-1)?.error).toBe('device_stt_permission_denied');
    });

    it('cancels a pending permission request before it can start recognition', async () => {
        let grant!: (value: { granted: boolean }) => void;
        permission.mockImplementation(() => new Promise(resolve => { grant = resolve; }));
        const { controller, start } = setup();
        const pending = controller.start('coordinator');
        controller.cancel('coordinator');
        grant({ granted: true });
        await pending;
        expect(start).not.toHaveBeenCalled();
    });

    it('aborts and discards recognition and removes listeners, including after start failure', async () => {
        const { controller, patches, abort } = setup();
        await controller.start('coordinator');
        emit('result', { results: [{ transcript: 'discard this' }] });
        controller.cancel('coordinator');
        expect(abort).toHaveBeenCalledOnce();
        await expect(controller.stop('coordinator')).resolves.toBe('');
        const count = patches.length;
        emit('error', { error: 'network' });
        expect(patches).toHaveLength(count);

        __setExpoSpeechRecognitionImpls({ start: () => { throw new Error('unavailable'); } });
        await expect(controller.start('coordinator')).rejects.toThrow('unavailable');
        const afterFailure = patches.length;
        emit('error', { error: 'network' });
        expect(patches).toHaveLength(afterFailure);
    });
});
