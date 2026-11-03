import * as React from 'react';
import { Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { SessionViewComposerOverrides } from '@/components/sessions/model/sessionComposerOverrides';
import { storage } from '@/sync/domains/state/storage';
import { useActiveServerAccountScope } from '@/sync/store/hooks';
import { getSessionDraftSnapshot, writeExistingSessionDraft } from '@/sync/ops/sessionDrafts/sessionDraftRepository';
import { t } from '@/text';
import { createDeviceSttController } from '@/voice/input/DeviceSttController';
import { useDeskPref } from '../deskPrefs';
import { reduceHoldSpace, type HoldSpaceEvent, type HoldSpaceState } from './holdSpace';

export function mergeDictationTranscript(draft: string, transcript: string): string {
    const text = transcript.trim();
    if (!text) return draft;
    return `${draft}${draft && !/\s$/.test(draft) ? ' ' : ''}${text}`;
}

type DictationState = 'idle' | 'listening' | 'error';
type DictationActions = { press(): void; release(): void; cancel(): void; releaseHold(): void };
type DictationOptions = { holdSpace?: boolean };

/** Device recognition only. The draft repository owns text; there is no send dependency. */
export function useDeskDictation(sessionId: string, options?: DictationOptions) {
    const scope = useActiveServerAccountScope();
    const [state, setState] = React.useState<DictationState>('idle');
    const [startedByHold, setStartedByHold] = React.useState(false);
    const holdSpaceEnabled = React.useRef(true);
    holdSpaceEnabled.current = options?.holdSpace ?? true;
    const actions = React.useRef<DictationActions | null>(null);
    const interruptedHold = React.useRef(false);

    React.useEffect(() => {
        let disposed = false;
        let hold: HoldSpaceState = { phase: interruptedHold.current ? 'suppressing' : 'idle' };
        interruptedHold.current = false;
        let operation: { stopping: boolean; recording: boolean } | null = null;
        const update = (next: DictationState) => { if (!disposed) setState(next); };
        const cancel = () => {
            operation = null;
            controller.cancel(sessionId);
            update('idle');
        };
        const fail = () => {
            operation = null;
            controller.cancel(sessionId);
            update('error');
        };
        const finish = async () => {
            const current = operation;
            if (!current || current.stopping) return;
            current.stopping = true;
            try {
                const transcript = await controller.stop(sessionId);
                if (disposed || operation !== current) return;
                operation = null;
                if (scope && transcript.trim()) {
                    const draft = getSessionDraftSnapshot(scope, { kind: 'session', sessionId })?.document.composer.text.value ?? '';
                    writeExistingSessionDraft({ scope, sessionId, patch: { text: mergeDictationTranscript(draft, transcript) } });
                }
                update('idle');
            } catch {
                if (!disposed && operation === current) fail();
            }
        };
        const controller = createDeviceSttController({
            getSettings: () => storage.getState().settings,
            canAutoStopTurn: () => false,
            onAutoStopTurn: () => {},
            dictation: true,
            onRecognitionEnd: () => { void finish(); },
            setState: patch => {
                if (disposed || !operation) return;
                if (patch.error) fail();
                else if (patch.status === 'recording') {
                    operation.recording = true;
                    update('listening');
                }
            },
        });
        const release = () => {
            if (operation?.recording) void finish();
            else if (operation) cancel(); // Withdraw permission/start without ever starting another operation.
        };
        const press = (byHold = false) => {
            if (disposed) return;
            if (operation) {
                release();
                return;
            }
            if (!scope) { update('error'); return; }
            setStartedByHold(byHold);
            const current = { stopping: false, recording: false };
            operation = current;
            update('idle');
            void controller.start(sessionId).catch(() => {
                if (!disposed && operation === current) fail();
            });
        };
        update('idle');
        setStartedByHold(false);
        const gesture = (event: HoldSpaceEvent) => {
            const result = reduceHoldSpace(hold, event);
            hold = result.next;
            if (result.action === 'start') press(true);
            else if (result.action === 'release') release();
            else if (result.action === 'cancel') cancel();
            return result;
        };
        actions.current = {
            press, release, cancel,
            releaseHold: () => { if (hold.phase === 'holding') gesture({ type: 'blur' }); },
        };
        const onKey = (event: KeyboardEvent) => {
            // AgentInput owns this test id. Require the actual input AND the desk pane,
            // so worker/new-session composers and Shog controls keep their own Space behavior.
            const target = event.target;
            const input = target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement ? target : null;
            const isSessionInput = Boolean(input?.closest('[data-testid="ip-coordinator-pane"]')
                && input.closest('[data-testid="session-composer-input"]'));
            const result = gesture({
                type: event.type === 'keyup' ? 'keyup' : 'keydown',
                key: event.key, repeat: event.repeat,
                shiftKey: event.shiftKey, ctrlKey: event.ctrlKey, altKey: event.altKey, metaKey: event.metaKey,
                isComposing: event.isComposing, keyCode: event.keyCode,
                isSessionInput, isInputEmpty: input?.value === '',
                dictationActive: operation !== null, enabled: holdSpaceEnabled.current,
            });
            if (result.preventDefault) event.preventDefault();
            if (result.action === 'cancel') { event.stopPropagation(); return; }
            if (event.type !== 'keydown') return;
            if (event.key !== 'Escape' || !operation) return;
            event.preventDefault();
            event.stopPropagation();
            cancel();
        };
        const onBlur = () => {
            const result = gesture({ type: 'blur' });
            if (!result.action) release();
        };
        const onVisibility = () => { if (document.visibilityState === 'hidden') onBlur(); };
        const web = Platform.OS === 'web' && typeof window !== 'undefined' && typeof document !== 'undefined';
        if (web) {
            window.addEventListener('keydown', onKey, true);
            window.addEventListener('keyup', onKey, true);
            window.addEventListener('blur', onBlur);
            document.addEventListener('visibilitychange', onVisibility);
        }
        return () => {
            // A session/scope change cancels recognition while the physical key may still be down.
            interruptedHold.current = hold.phase === 'holding' || hold.phase === 'suppressing';
            disposed = true;
            actions.current = null;
            operation = null;
            controller.cancel(sessionId);
            if (web) {
                window.removeEventListener('keydown', onKey, true);
                window.removeEventListener('keyup', onKey, true);
                window.removeEventListener('blur', onBlur);
                document.removeEventListener('visibilitychange', onVisibility);
            }
        };
    }, [sessionId, scope?.serverId, scope?.accountId]);

    React.useEffect(() => {
        if (options?.holdSpace === false) actions.current?.releaseHold();
    }, [options?.holdSpace]);

    React.useEffect(() => () => {
        // Runs after the session effect cleanup; carry holds only across restarts, not unmounts.
        interruptedHold.current = false;
    }, []);

    const onPress = React.useCallback(() => actions.current?.press(), []);
    const cancel = React.useCallback(() => actions.current?.cancel(), []);
    const release = React.useCallback(() => actions.current?.release(), []);
    const mic = React.useMemo(() => ({ onPress, isActive: state === 'listening' }), [onPress, state]);
    return { mic, state, cancel, release, startedByHold };
}

/** AgentInput's submit mic is voice-gated and disappears with a draft. Use its existing badge slot. */
export function useDeskDictationControls(sessionId: string, controls: SessionViewComposerOverrides, options?: DictationOptions): SessionViewComposerOverrides {
    const [holdSpacePreference] = useDeskPref('deskHoldSpace');
    const holdSpace = options?.holdSpace ?? holdSpacePreference;
    const { mic, state, startedByHold } = useDeskDictation(sessionId, { holdSpace });
    return React.useMemo(() => {
        const listening = t(startedByHold ? 'ignorePrevious.dictation.listeningHoldSpace' : 'ignorePrevious.dictation.listening');
        const status = state === 'listening' ? listening : t('ignorePrevious.dictation.failed');
        const hint = t(state === 'error' ? 'ignorePrevious.dictation.error' : 'ignorePrevious.dictation.instructions');
        const holdHint = Platform.OS === 'web' && holdSpace ? ` ${t('ignorePrevious.dictation.holdSpaceHint')}` : '';
        return {
            ...controls,
            mic: null,
            statusBadges: [...(controls.statusBadges ?? []), {
                key: 'desk-dictation',
                testID: 'ip-dictation-status',
                label: `${state === 'idle' ? '' : `${status} `}${t('ignorePrevious.dictation.privacyShort')}`,
                accessibilityLabel: `${t(mic.isActive ? 'ignorePrevious.dictation.stop' : 'ignorePrevious.dictation.start')} ${t('ignorePrevious.dictation.privacy')}`,
                accessibilityHint: `${hint}${holdHint}`,
                tone: state === 'error' ? 'danger' : mic.isActive ? 'active' : 'neutral',
                onPress: mic.onPress,
                icon: (tint: string) => React.createElement(Ionicons, { name: mic.isActive ? 'mic' : 'mic-outline', size: 16, color: tint }),
            }],
        };
    }, [controls, mic, state, startedByHold, holdSpace]);
}
