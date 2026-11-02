import * as React from 'react';
import { Ionicons } from '@expo/vector-icons';
import type { SessionViewComposerOverrides } from '@/components/sessions/model/sessionComposerOverrides';
import { storage } from '@/sync/domains/state/storage';
import { useActiveServerAccountScope } from '@/sync/store/hooks';
import { getSessionDraftSnapshot, writeExistingSessionDraft } from '@/sync/ops/sessionDrafts/sessionDraftRepository';
import { t } from '@/text';
import { createDeviceSttController } from '@/voice/input/DeviceSttController';

export function mergeDictationTranscript(draft: string, transcript: string): string {
    const text = transcript.trim();
    if (!text) return draft;
    return `${draft}${draft && !/\s$/.test(draft) ? ' ' : ''}${text}`;
}

type DictationState = 'idle' | 'listening' | 'error';
type DictationActions = { press(): void; cancel(): void };

/** Device recognition only. The draft repository owns text; there is no send dependency. */
export function useDeskDictation(sessionId: string) {
    const scope = useActiveServerAccountScope();
    const [state, setState] = React.useState<DictationState>('idle');
    const actions = React.useRef<DictationActions | null>(null);

    React.useEffect(() => {
        let disposed = false;
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
            accumulateFinalResults: true,
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
        const press = () => {
            if (disposed) return;
            if (operation) {
                if (operation?.recording) void finish();
                else cancel(); // A second press during permission/start withdraws that request.
                return;
            }
            if (!scope) { update('error'); return; }
            const current = { stopping: false, recording: false };
            operation = current;
            update('idle');
            void controller.start(sessionId).catch(() => {
                if (!disposed && operation === current) fail();
            });
        };
        actions.current = { press, cancel };
        update('idle');
        const onKey = (event: KeyboardEvent) => {
            if (event.key !== 'Escape' || !operation) return;
            event.preventDefault();
            event.stopPropagation();
            cancel();
        };
        const onBlur = () => {
            if (operation?.recording) void finish();
            else if (operation) cancel();
        };
        const onVisibility = () => { if (document.visibilityState === 'hidden') onBlur(); };
        if (typeof window !== 'undefined' && typeof document !== 'undefined') {
            window.addEventListener('keydown', onKey, true);
            window.addEventListener('blur', onBlur);
            document.addEventListener('visibilitychange', onVisibility);
        }
        return () => {
            disposed = true;
            actions.current = null;
            operation = null;
            controller.cancel(sessionId);
            if (typeof window !== 'undefined' && typeof document !== 'undefined') {
                window.removeEventListener('keydown', onKey, true);
                window.removeEventListener('blur', onBlur);
                document.removeEventListener('visibilitychange', onVisibility);
            }
        };
    }, [sessionId, scope?.serverId, scope?.accountId]);

    const onPress = React.useCallback(() => actions.current?.press(), []);
    const cancel = React.useCallback(() => actions.current?.cancel(), []);
    const mic = React.useMemo(() => ({ onPress, isActive: state === 'listening' }), [onPress, state]);
    return { mic, state, cancel };
}

/** AgentInput's submit mic is voice-gated and disappears with a draft. Use its existing badge slot. */
export function useDeskDictationControls(sessionId: string, controls: SessionViewComposerOverrides): SessionViewComposerOverrides {
    const { mic, state } = useDeskDictation(sessionId);
    return React.useMemo(() => ({
        ...controls,
        mic: null,
        statusBadges: [...(controls.statusBadges ?? []), {
            key: 'desk-dictation',
            testID: 'ip-dictation-status',
            label: `${state === 'idle' ? '' : `${t(state === 'listening' ? 'ignorePrevious.dictation.listening' : 'ignorePrevious.dictation.failed')} `}${t('ignorePrevious.dictation.privacyShort')}`,
            accessibilityLabel: `${t(mic.isActive ? 'ignorePrevious.dictation.stop' : 'ignorePrevious.dictation.start')} ${t('ignorePrevious.dictation.privacy')}`,
            accessibilityHint: t(state === 'error' ? 'ignorePrevious.dictation.error' : 'ignorePrevious.dictation.instructions'),
            tone: state === 'error' ? 'danger' : mic.isActive ? 'active' : 'neutral',
            onPress: mic.onPress,
            icon: (tint: string) => React.createElement(Ionicons, { name: mic.isActive ? 'mic' : 'mic-outline', size: 16, color: tint }),
        }],
    }), [controls, mic, state]);
}
