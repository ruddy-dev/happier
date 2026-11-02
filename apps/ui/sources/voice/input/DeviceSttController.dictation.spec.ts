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
afterEach(() => vi.restoreAllMocks());

function setup(accumulateFinalResults = false) {
    const patches: Array<{ status?: string; error?: string | null }> = [];
    const start = vi.fn();
    const abort = vi.fn();
    __setExpoSpeechRecognitionImpls({ start, abort, stop: () => emit('end') });
    const controller = createDeviceSttController({
        setState: patch => patches.push(patch), getSettings: () => ({}),
        canAutoStopTurn: () => false, onAutoStopTurn: vi.fn(),
        accumulateFinalResults,
    });
    return { controller, patches, start, abort };
}

describe('device dictation lifecycle', () => {
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
