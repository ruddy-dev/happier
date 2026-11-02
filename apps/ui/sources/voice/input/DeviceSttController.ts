import { requestMicrophonePermission, showMicrophonePermissionDeniedAlert } from '@/utils/platform/microphonePermissions';
import { createTurnEndpointDetector, type TurnEndpointDetector } from '@/voice/input/TurnEndpointDetector';
import { isHandsFreeSttEnabled, resolveHandsFreeTurnEndpointPolicy } from '@/voice/local/localVoiceSettings';
import { Platform } from 'react-native';

type DeviceSttStatePatch = {
  status?: 'idle' | 'recording' | 'transcribing' | 'sending' | 'speaking' | 'error';
  sessionId?: string | null;
  error?: string | null;
};

type DeviceSttHandle = {
  sessionId: string;
  transcript: string;
  startedAt: number;
  endpointDetector: TurnEndpointDetector;
  module: any;
  resolveEnd: () => void;
  endPromise: Promise<void>;
  subscriptions: { remove(): void }[];
};

export type DeviceSttController = Readonly<{
  /** Cancels pending permission/start and discards the active transcript. */
  cancel: (sessionId: string) => void;
  clearHandsFreeSession: (sessionId?: string) => void;
  isHandsFreeSession: (sessionId: string) => boolean;
  start: (sessionId: string) => Promise<void>;
  stop: (sessionId: string) => Promise<string>;
  setHandsFreeSession: (sessionId: string | null) => void;
}>;

export function createDeviceSttController(deps: {
  setState: (patch: DeviceSttStatePatch) => void;
  getSettings: () => any;
  canAutoStopTurn: (sessionId: string) => boolean;
  onAutoStopTurn: (sessionId: string) => void;
  /** Optional dictation consumer: browser recognition can end without a stop press. */
  onRecognitionEnd?: (sessionId: string) => void;
  /** Opts into dictation phrase accumulation, cancellation and error lifecycle. */
  dictation?: boolean;
}): DeviceSttController {
  let handle: DeviceSttHandle | null = null;
  let handsFreeSessionId: string | null = null;
  let pendingStart: { sessionId: string } | null = null;

  const isDomRuntime = (): boolean => typeof window !== 'undefined' && typeof document !== 'undefined';

  const isHandsFreeDeviceSttEnabled = (): boolean => isHandsFreeSttEnabled(deps.getSettings());

  const cleanupListeners = (target = handle) => {
    const subscriptions = target?.subscriptions ?? [];
    try {
      subscriptions.forEach((subscription) => subscription.remove());
    } catch {
      // ignore
    }
  };

  const clearHandsFreeSession = (sessionId?: string) => {
    if (sessionId && handsFreeSessionId && handsFreeSessionId !== sessionId) {
      return;
    }
    handsFreeSessionId = null;
  };

  const cancel = (sessionId: string) => {
    if (!deps.dictation) return;
    if (pendingStart?.sessionId === sessionId) pendingStart = null;
    const target = handle;
    if (!target || target.sessionId !== sessionId) return;
    handle = null;
    target.endpointDetector.cancel();
    cleanupListeners(target);
    target.resolveEnd();
    target.transcript = '';
    try { target.module?.abort?.(); } catch {
      // Content-free default signal also survives a consumer's UI teardown.
      console.error('device_stt_cancel_failed');
      deps.setState({ status: 'error', sessionId: null, error: 'device_stt_cancel_failed' });
    }
  };

  const start = async (sessionId: string) => {
    const attempt = { sessionId };
    if (deps.dictation) pendingStart = attempt;
    const microphonePermission = await requestMicrophonePermission();
    if (deps.dictation && pendingStart !== attempt) return;
    if (!microphonePermission.granted) {
      if (deps.dictation) {
        pendingStart = null;
        deps.setState({ status: 'idle', sessionId: null, error: 'device_stt_permission_denied' });
      }
      showMicrophonePermissionDeniedAlert(microphonePermission.canAskAgain);
      return;
    }

    const { ExpoSpeechRecognitionModule } = await import('expo-speech-recognition');
    if (deps.dictation && pendingStart !== attempt) return;

    if (typeof ExpoSpeechRecognitionModule?.isRecognitionAvailable === 'function' && !ExpoSpeechRecognitionModule.isRecognitionAvailable()) {
      deps.setState({ status: 'idle', sessionId: null, error: 'device_stt_unavailable' });
      return;
    }

    // `expo-speech-recognition` logs noisy "not supported on web" warnings for this call.
    // Prefer DOM detection over Platform.OS so web builds remain resilient even if Platform.OS is surprising.
    if (Platform.OS !== 'web' && !isDomRuntime()) {
      try {
        const permissionsResponse = await ExpoSpeechRecognitionModule.requestPermissionsAsync?.();
        if (permissionsResponse && permissionsResponse.granted === false) {
          deps.setState({ status: 'idle', sessionId: null, error: 'device_stt_permission_denied' });
          return;
        }
      } catch {
        // Permission request best-effort.
      }
    }

    if (deps.dictation && pendingStart !== attempt) return;
    if (deps.dictation) pendingStart = null;
    handle?.endpointDetector.cancel();
    cleanupListeners();

    let resolveEnd: null | (() => void) = null;
    const endPromise = new Promise<void>((resolve) => {
      resolveEnd = resolve;
    });

    const nextHandle: DeviceSttHandle = {
      sessionId,
      transcript: '',
      startedAt: Date.now(),
      endpointDetector: createTurnEndpointDetector({
        onEndpoint: () => {
          if (handle !== nextHandle || handsFreeSessionId !== sessionId) return;
          if (!isHandsFreeDeviceSttEnabled() || !deps.canAutoStopTurn(sessionId)) return;
          deps.onAutoStopTurn(sessionId);
        },
      }),
      module: ExpoSpeechRecognitionModule,
      resolveEnd: () => resolveEnd?.(),
      endPromise,
      subscriptions: [],
    };

    handle = nextHandle;

    nextHandle.subscriptions.push(
      ExpoSpeechRecognitionModule.addListener('speechstart', () => {
        nextHandle.endpointDetector.cancel();
      })
    );

    let finalizedTranscript = '';
    nextHandle.subscriptions.push(
      ExpoSpeechRecognitionModule.addListener('result', (event: any) => {
        const results = Array.isArray(event?.results) ? event.results : [];
        const transcript = typeof results?.[0]?.transcript === 'string' ? results[0].transcript.trim() : '';
        if (!transcript) return;

        // expo-speech-recognition 3.1 emits each finalized phrase separately on web.
        nextHandle.transcript = deps.dictation && finalizedTranscript
          ? `${finalizedTranscript} ${transcript}`
          : transcript;
        if (deps.dictation && event?.isFinal === true) finalizedTranscript = nextHandle.transcript;
        if (isHandsFreeDeviceSttEnabled()) {
          nextHandle.endpointDetector.observe({
            transcript,
            isEndpoint: event?.isFinal === true,
            policy: resolveHandsFreeTurnEndpointPolicy(deps.getSettings()),
            speechElapsedMs: Date.now() - nextHandle.startedAt,
          });
        } else {
          nextHandle.endpointDetector.cancel();
        }
      })
    );

    nextHandle.subscriptions.push(
      ExpoSpeechRecognitionModule.addListener('end', () => {
        nextHandle.resolveEnd();
        if (deps.dictation && handle === nextHandle) deps.onRecognitionEnd?.(sessionId);
      })
    );

    nextHandle.subscriptions.push(
      ExpoSpeechRecognitionModule.addListener('error', () => {
        nextHandle.resolveEnd();
        if (deps.dictation && handle === nextHandle) deps.setState({ status: 'error', sessionId: null, error: 'device_stt_recognition_failed' });
      })
    );

    const settings = deps.getSettings();
    const language = typeof settings?.voice?.assistantLanguage === 'string' && settings.voice.assistantLanguage.trim()
      ? settings.voice.assistantLanguage.trim()
      : undefined;

    try {
      ExpoSpeechRecognitionModule.start({
        ...(language ? { lang: language } : {}),
        interimResults: true,
        maxAlternatives: 1,
        continuous: true,
      } as any);
    } catch (error) {
      if (deps.dictation) cancel(sessionId);
      else handle = null;
      deps.setState({ status: 'idle', sessionId: null, error: 'device_stt_start_failed' });
      throw error;
    }

    deps.setState({ status: 'recording', sessionId, error: null });
  };

  const stop = async (sessionId: string): Promise<string> => {
    if (!handle || handle.sessionId !== sessionId) {
      return '';
    }

    const target = handle;
    target.endpointDetector.cancel();

    try {
      target.module?.stop?.();
    } catch {
      if (deps.dictation) deps.setState({ status: 'error', sessionId: null, error: 'device_stt_stop_failed' });
    }

    // Keep the existing stop budget and lifecycle for callers that do not opt into dictation.
    let timeout: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([target.endPromise, new Promise<void>((resolve) => { timeout = setTimeout(resolve, 5_000); })]);
    if (deps.dictation && timeout !== undefined) clearTimeout(timeout);
    // Legacy callers consume the current handle after waiting; dictation can cancel or replace it.
    const stoppedHandle = deps.dictation ? target : handle!;
    const text = stoppedHandle.transcript.trim();
    stoppedHandle.endpointDetector.cancel();
    if (!deps.dictation || handle === target) handle = null;
    cleanupListeners(stoppedHandle);

    return text;
  };

  return {
    cancel,
    clearHandsFreeSession,
    isHandsFreeSession: (sessionId: string) => handsFreeSessionId === sessionId,
    setHandsFreeSession: (sessionId: string | null) => {
      handsFreeSessionId = sessionId;
    },
    start,
    stop,
  };
}
