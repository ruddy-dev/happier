import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    emitSpeechRecEvent,
    getStorage,
    registerLocalVoiceEngineHarnessHooks,
    speechRecStart,
    speechRecStop,
    submitMessage,
} from './localVoiceEngine.testHarness';

describe('local voice engine device STT error recovery', () => {
    registerLocalVoiceEngineHarnessHooks();
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => {
        vi.clearAllTimers();
        vi.useRealTimers();
    });

    it.each(['hang up', 'stop turn'])('can %s after a recognizer error and start again', async (action) => {
        const storage = await getStorage();
        const settings = storage.getState().settings;
        storage.__setState({
            settings: {
                ...settings,
                voice: {
                    ...settings.voice,
                    providerId: 'local_direct',
                    adapters: {
                        ...settings.voice.adapters,
                        local_direct: {
                            ...settings.voice.adapters.local_direct,
                            stt: { ...settings.voice.adapters.local_direct.stt, useDeviceStt: true, baseUrl: null },
                            tts: { ...settings.voice.adapters.local_direct.tts, autoSpeakReplies: false },
                            handsFree: {
                                ...settings.voice.adapters.local_direct.handsFree,
                                enabled: true,
                                endpointing: { silenceMs: 450, minSpeechMs: 0 },
                            },
                        },
                    },
                },
            },
        });

        const { toggleLocalVoiceTurn, stopLocalVoiceSession, getLocalVoiceState } = await import('./localVoiceEngine');
        await toggleLocalVoiceTurn('s1');
        emitSpeechRecEvent('result', { isFinal: true, results: [{ transcript: 'recognized words' }] });
        emitSpeechRecEvent('error', { error: 'network' });

        const stopping = action === 'hang up' ? stopLocalVoiceSession() : toggleLocalVoiceTurn('s1');
        await stopping;
        expect(speechRecStop).toHaveBeenCalledOnce();
        const stoppedState = { status: 'idle', sessionId: action === 'hang up' ? null : 's1' };
        expect(getLocalVoiceState()).toMatchObject(stoppedState);
        if (action === 'hang up') expect(submitMessage).not.toHaveBeenCalled();
        else expect(submitMessage).toHaveBeenCalledWith('s1', 'recognized words', undefined, undefined, {
            callerSurface: 'voice_turn', forceImmediate: true,
        });

        // Removed listeners and hands-free deadlines must not restart the old recording.
        emitSpeechRecEvent('result', { isFinal: true, results: [{ transcript: 'late words' }] });
        emitSpeechRecEvent('error', { error: 'network' });
        emitSpeechRecEvent('end', {});
        await vi.advanceTimersByTimeAsync(450);
        expect(getLocalVoiceState()).toMatchObject(stoppedState);
        expect(speechRecStart).toHaveBeenCalledOnce();

        await toggleLocalVoiceTurn('s1');
        expect(speechRecStart).toHaveBeenCalledTimes(2);
        expect(getLocalVoiceState()).toMatchObject({ status: 'recording', sessionId: 's1' });
        const hangingUp = stopLocalVoiceSession();
        emitSpeechRecEvent('end', {});
        await hangingUp;
    });
});
