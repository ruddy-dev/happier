/** @vitest-environment jsdom */
import { act } from 'react-test-renderer';
import { Platform } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, standardCleanup, resetBrowserSessionDraftPersistenceForTest } from '@/dev/testkit';
import { createWebAudioBoundary } from '@/dev/testkit/harness/webAudio';
import { __emitSpeechRecognitionEvent as emit, __resetExpoSpeechRecognitionStub, __setExpoSpeechRecognitionImpls } from '@/dev/expoSpeechRecognitionStub';
import { t } from '@/text';
import { storage } from '@/sync/domains/state/storage';
import { getSessionDraftSnapshot, writeExistingSessionDraft } from '@/sync/ops/sessionDrafts/sessionDraftRepository';
import { createComposerTextStore } from '@/components/sessions/agentInput/composerTextStore';
import { useDraft } from '@/hooks/session/useDraft';
import { useSessionComposerOverrides } from '@/components/sessions/model/sessionComposerOverrides';
import { mergeDictationTranscript, useDeskDictation, useDeskDictationControls } from './useDeskDictation';
import { deskPrefs } from '../deskPrefs';

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock({ Platform: { OS: 'web' } });
});

const send = vi.hoisted(() => vi.fn());
vi.mock('@/sync/sync', async () => {
    const { createSyncModuleStub } = await import('@/dev/testkit/mocks/sync');
    return { sync: {
        ...createSyncModuleStub().sync,
        submitMessage: send, sendMessage: send, enqueuePendingMessage: send,
        materializeExistingSessionDraft: async () => {},
    } };
});

vi.mock('@react-navigation/native', async () => {
    const { createReactNavigationNativeMock } = await import('@/dev/testkit/mocks/reactNavigation');
    return createReactNavigationNativeMock();
});

vi.mock('@/modal', async () => {
    const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
    return createModalModuleMock().module;
});

const scope = { serverId: 'dictation-server', accountId: 'dictation-account' };
const sessionId = 'coordinator';
const previous = storage.getState();
let getUserMedia: ReturnType<typeof vi.fn>;
let start: ReturnType<typeof vi.fn>;
let abort: ReturnType<typeof vi.fn>;
let stopTrack: ReturnType<typeof vi.fn>;
let audio: ReturnType<typeof createWebAudioBoundary>;
function draft(id = sessionId) {
    return getSessionDraftSnapshot(scope, { kind: 'session', sessionId: id })?.document.composer.text.value ?? '';
}
function type(text: string) { writeExistingSessionDraft({ scope, sessionId, patch: { text } }); }
async function press(hook: { getCurrent: () => ReturnType<typeof useDeskDictation> }) {
    await act(async () => { hook.getCurrent().mic.onPress(); });
}

beforeEach(async () => {
    await resetBrowserSessionDraftPersistenceForTest();
    __resetExpoSpeechRecognitionStub();
    storage.setState({ profileScope: scope });
    type('');
    audio = createWebAudioBoundary();
    vi.stubGlobal('AudioContext', audio.AudioContext);
    stopTrack = vi.fn();
    getUserMedia = vi.fn(async () => ({ getTracks: () => [{ stop: stopTrack }] }));
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
    start = vi.fn();
    abort = vi.fn();
    __setExpoSpeechRecognitionImpls({ start, abort, stop: () => emit('end') });
});
afterEach(async () => {
    await standardCleanup();
    document.body.replaceChildren();
    expect(send).not.toHaveBeenCalled();
    send.mockClear();
    storage.setState(previous, true);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('unsent desk dictation', () => {
    it.each([
        ['', 'hello', 'hello'], ['Draft', 'hello', 'Draft hello'],
        ['Draft ', 'hello', 'Draft hello'], ['Draft\n', 'hello', 'Draft\nhello'],
        ['Draft', '', 'Draft'], ['Draft', '   ', 'Draft'],
    ])('merges %j and %j', (text, transcript, expected) => {
        expect(mergeDictationTranscript(text, transcript)).toBe(expected);
    });

    it('asks permission only on press, stops on second press and appends to the latest draft without sending', async () => {
        const hook = await renderHook(() => useDeskDictation(sessionId));
        expect(getUserMedia).not.toHaveBeenCalled();
        expect(start).not.toHaveBeenCalled();
        await press(hook);
        expect(getUserMedia).toHaveBeenCalledOnce();
        expect(hook.getCurrent().state).toBe('listening');
        expect(hook.getCurrent().mic.isActive).toBe(true);
        type('Edited while listening');
        emit('result', { isFinal: true, results: [{ transcript: 'first phrase' }] });
        emit('result', { isFinal: true, results: [{ transcript: 'dictated text' }] });
        expect(draft()).toBe('Edited while listening');
        await press(hook);
        expect(draft()).toBe('Edited while listening first phrase dictated text');
        expect(hook.getCurrent().mic.isActive).toBe(false);
        expect(send).not.toHaveBeenCalled();
        expect(audio.sources).toHaveLength(0);
    });

    it('mounts and cleans up without DOM listeners when the native window has no document', async () => {
        vi.stubGlobal('document', undefined);
        try {
            const hook = await renderHook(() => useDeskDictation(sessionId));
            expect(hook.getCurrent().state).toBe('idle');
            expect(getUserMedia).not.toHaveBeenCalled();
            await hook.unmount();
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it('updates the live composer store through the real draft subscriber', async () => {
        const textStore = createComposerTextStore('');
        const hook = await renderHook(() => {
            const draftOwner = useDraft(sessionId, textStore, { active: true });
            return { ...useDeskDictation(sessionId), draftOwner };
        });
        await act(async () => { hook.getCurrent().draftOwner.setDraftValue('Typed prefix'); });
        await press(hook);
        emit('result', { results: [{ transcript: 'spoken suffix' }] });
        await press(hook);
        expect(textStore.getPrompt()).toBe('Typed prefix spoken suffix');
        expect(draft()).toBe(textStore.getPrompt());
    });

    it('a speech-service end stops and merges without sending', async () => {
        const hook = await renderHook(() => useDeskDictation(sessionId));
        await press(hook);
        emit('result', { results: [{ transcript: 'finished speech' }] });
        await act(async () => { emit('end'); });
        expect(draft()).toBe('finished speech');
        expect(hook.getCurrent().state).toBe('idle');
    });

    it('Escape during a pending stop discards its late result', async () => {
        __setExpoSpeechRecognitionImpls({ stop: () => {} });
        const hook = await renderHook(() => useDeskDictation(sessionId));
        await press(hook);
        emit('result', { results: [{ transcript: 'discard after stop' }] });
        await press(hook);
        await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
        emit('end');
        expect(draft()).toBe('');
        expect(hook.getCurrent().state).toBe('idle');
    });

    it('Escape discards the transcript', async () => {
        type('Keep this');
        const hook = await renderHook(() => useDeskDictation(sessionId));
        await press(hook);
        emit('result', { results: [{ transcript: 'discard' }] });
        await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
        expect(abort).toHaveBeenCalledOnce();
        expect(draft()).toBe('Keep this');
        expect(hook.getCurrent().state).toBe('idle');
    });

    it.each(['blur', 'hidden'])('%s stops and merges', async (event) => {
        const hook = await renderHook(() => useDeskDictation(sessionId));
        await press(hook);
        emit('result', { results: [{ transcript: 'keep speech' }] });
        await act(async () => {
            if (event === 'blur') window.dispatchEvent(new Event('blur'));
            else {
                vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
                document.dispatchEvent(new Event('visibilitychange'));
            }
        });
        expect(draft()).toBe('keep speech');
        expect(hook.getCurrent().state).toBe('idle');
    });

    it('cancels on session change and unmount and ignores late recognition events', async () => {
        const hook = await renderHook(({ id }) => useDeskDictation(id), { initialProps: { id: sessionId } });
        await press(hook);
        emit('result', { results: [{ transcript: 'old session' }] });
        await hook.rerender({ id: 'another-coordinator' });
        expect(abort).toHaveBeenCalledOnce();
        expect(hook.getCurrent().mic.isActive).toBe(false);
        await press(hook);
        await hook.unmount();
        emit('result', { results: [{ transcript: 'late result' }] });
        emit('end');
        window.dispatchEvent(new Event('blur'));
        expect(abort).toHaveBeenCalledTimes(2);
        expect(draft()).toBe('');
        expect(draft('another-coordinator')).toBe('');
    });

    it('cancels while permission is pending without late start or draft updates', async () => {
        let grant!: (value: { getTracks: () => [] }) => void;
        getUserMedia.mockImplementation(() => new Promise(resolve => { grant = resolve; }));
        const hook = await renderHook(() => useDeskDictation(sessionId));
        await press(hook);
        await hook.unmount();
        await act(async () => { grant({ getTracks: () => [] }); });
        expect(start).not.toHaveBeenCalled();
        expect(draft()).toBe('');
    });

    it.each(['permission', 'start', 'recognition'])('%s failure shows an error and releases the mic', async (failure) => {
        if (failure === 'permission') getUserMedia.mockRejectedValue(new DOMException('Denied', 'NotAllowedError'));
        if (failure === 'start') __setExpoSpeechRecognitionImpls({ start: () => { throw new Error('Failed'); } });
        const hook = await renderHook(() => useDeskDictation(sessionId));
        await press(hook);
        if (failure === 'recognition') await act(async () => { emit('error', { error: 'network' }); });
        expect(hook.getCurrent().state).toBe('error');
        expect(hook.getCurrent().mic.isActive).toBe(false);
        expect(draft()).toBe('');
    });

    it('replaces the composer mic and exposes status and privacy through existing badges with voice disabled', async () => {
        const hook = await renderHook(() => {
            const controls = useDeskDictationControls(sessionId, { mic: null, hide: { stop: true } });
            const resolved = useSessionComposerOverrides({
                isReadOnly: false, placeholder: '', extraActionChips: [], statusBadges: [],
                providerUsageGauge: null, onMicPress: undefined, isMicActive: false,
                onAbort: undefined, alwaysShowContextSize: false,
            }, controls);
            return { controls, resolved };
        });
        expect(hook.getCurrent().resolved.onMicPress).toBeUndefined();
        expect(hook.getCurrent().resolved.statusBadges.some(badge => badge.testID === 'ip-dictation-status')).toBe(true);
        await act(async () => { hook.getCurrent().resolved.statusBadges.find(badge => badge.testID === 'ip-dictation-status')?.onPress?.(); });
        expect(hook.getCurrent().resolved.statusBadges.find(badge => badge.testID === 'ip-dictation-status')?.tone).toBe('active');
        expect(hook.getCurrent().controls.hide?.stop).toBe(true);
    });
});

function sessionInput(pane = 'ip-coordinator-pane', testId = 'session-composer-input', wrapped = false) {
    const root = document.createElement('div');
    root.dataset.testid = pane;
    const input = document.createElement('textarea');
    const marker = wrapped ? document.createElement('div') : input;
    marker.dataset.testid = testId;
    if (wrapped) marker.append(input);
    root.append(marker);
    document.body.append(root);
    input.focus();
    return input;
}
async function key(target: EventTarget, type: 'keydown' | 'keyup', key = ' ', init: KeyboardEventInit = {}) {
    const event = new KeyboardEvent(type, { key, bubbles: true, cancelable: true, ...init });
    await act(async () => { target.dispatchEvent(event); });
    return event;
}
function badge(controls: ReturnType<typeof useDeskDictationControls>) {
    return controls.statusBadges!.find(b => b.testID === 'ip-dictation-status')!;
}

describe('coordinator hold Space dictation', () => {
    it('passes ordinary Space typing through when the stored preference is off, including after remount', async () => {
        deskPrefs.set('deskHoldSpace', false);
        const hook = await renderHook(() => useDeskDictationControls(sessionId, {}));
        const input = sessionInput();
        expect((await key(input, 'keydown')).defaultPrevented).toBe(false);
        // jsdom has no keyboard default action; emulate the browser's unsuppressed text insertion.
        input.value += ' ';
        expect((await key(input, 'keydown', ' ', { repeat: true })).defaultPrevented).toBe(false);
        expect((await key(input, 'keyup')).defaultPrevented).toBe(false);
        expect(input.value).toBe(' ');
        expect(getUserMedia).not.toHaveBeenCalled();
        expect(badge(hook.getCurrent()).accessibilityHint).not.toContain(t('ignorePrevious.dictation.holdSpaceHint'));
        await hook.unmount();
        await renderHook(() => useDeskDictationControls(sessionId, {}));
        input.value = '';
        expect((await key(input, 'keydown')).defaultPrevented).toBe(false);
        expect(start).not.toHaveBeenCalled();
    });

    it.each([false, true])('an explicit hold Space option %s overrides the opposite stored preference', async enabled => {
        deskPrefs.set('deskHoldSpace', !enabled);
        const hook = await renderHook(() => useDeskDictationControls(sessionId, {}, { holdSpace: enabled }));
        const input = sessionInput();
        expect((await key(input, 'keydown')).defaultPrevented).toBe(enabled);
        expect(start).toHaveBeenCalledTimes(enabled ? 1 : 0);
        expect(badge(hook.getCurrent()).accessibilityHint?.includes(t('ignorePrevious.dictation.holdSpaceHint'))).toBe(enabled);
        if (enabled) {
            await act(async () => { deskPrefs.set('deskHoldSpace', true); });
            await act(async () => { deskPrefs.set('deskHoldSpace', false); });
            expect(badge(hook.getCurrent()).tone).toBe('active');
            await key(input, 'keyup');
        }
    });

    it('releases a held recording as soon as the preference turns off and can be enabled again', async () => {
        const hook = await renderHook(() => useDeskDictationControls(sessionId, {}));
        const input = sessionInput();
        await key(input, 'keydown');
        emit('result', { results: [{ transcript: 'keep held speech' }] });
        await act(async () => { deskPrefs.set('deskHoldSpace', false); });
        expect(badge(hook.getCurrent()).tone).toBe('neutral');
        expect(draft()).toBe('keep held speech');
        expect(stopTrack).toHaveBeenCalled();
        await key(input, 'keyup');
        expect((await key(input, 'keydown')).defaultPrevented).toBe(false);
        await act(async () => { deskPrefs.set('deskHoldSpace', true); });
        expect((await key(input, 'keydown', ' ', { repeat: true })).defaultPrevented).toBe(false);
        expect((await key(input, 'keydown')).defaultPrevented).toBe(true);
        await key(input, 'keyup');
        expect(start).toHaveBeenCalledTimes(2);
    });

    it('cancels a held pending permission when the preference turns off', async () => {
        let grant!: (value: { getTracks: () => [] }) => void;
        getUserMedia.mockImplementation(() => new Promise(resolve => { grant = resolve; }));
        const hook = await renderHook(() => useDeskDictationControls(sessionId, {}));
        const input = sessionInput();
        await key(input, 'keydown');
        await act(async () => { deskPrefs.set('deskHoldSpace', false); });
        await act(async () => { grant({ getTracks: () => [] }); });
        expect(start).not.toHaveBeenCalled();
        expect(badge(hook.getCurrent()).tone).toBe('neutral');
        expect(draft()).toBe('');
    });

    it('does not stop a mic-started recording when the hold preference turns off', async () => {
        const hook = await renderHook(() => useDeskDictationControls(sessionId, {}));
        await act(async () => { badge(hook.getCurrent()).onPress?.(); });
        await act(async () => { deskPrefs.set('deskHoldSpace', false); });
        expect(badge(hook.getCurrent()).tone).toBe('active');
        emit('result', { results: [{ transcript: 'mic speech' }] });
        await act(async () => { badge(hook.getCurrent()).onPress?.(); });
        expect(draft()).toBe('mic speech');
    });

    it.each([false, true])('starts from the empty input, suppresses repeat and merges unsent on release, wrapped=%s', async (wrapped) => {
        const hook = await renderHook(() => useDeskDictationControls(sessionId, {}));
        const input = sessionInput(undefined, undefined, wrapped);
        expect(getUserMedia).not.toHaveBeenCalled();
        expect((await key(input, 'keydown')).defaultPrevented).toBe(true);
        expect(getUserMedia).toHaveBeenCalledOnce();
        expect(badge(hook.getCurrent()).tone).toBe('active');
        expect(badge(hook.getCurrent()).label).toContain(t('ignorePrevious.dictation.listeningHoldSpace'));
        expect((await key(input, 'keydown', ' ', { repeat: true })).defaultPrevented).toBe(true);
        expect(start).toHaveBeenCalledOnce();
        emit('result', { results: [{ transcript: 'held speech' }] });
        expect(draft()).toBe('');
        expect((await key(input, 'keyup')).defaultPrevented).toBe(true);
        expect(input.value).toBe('');
        expect(draft()).toBe('held speech');
        expect(badge(hook.getCurrent()).tone).toBe('neutral');
    });

    it.each([
        ['non-empty', 'ip-coordinator-pane', 'session-composer-input', ' '],
        ['worker', 'worker-pane', 'session-composer-input', ''],
        ['Shog', 'ip-shog-panel', 'session-composer-input', ''],
        ['new session', 'ip-coordinator-pane', 'new-session-composer-input', ''],
        ['other textarea in coordinator', 'ip-coordinator-pane', 'other-input', ''],
    ])('passes Space through in %s', async (_case, pane, id, value) => {
        await renderHook(() => useDeskDictationControls(sessionId, {}));
        const input = sessionInput(pane, id);
        input.value = value;
        expect((await key(input, 'keydown')).defaultPrevented).toBe(false);
        expect((await key(input, 'keydown', ' ', { repeat: true })).defaultPrevented).toBe(false);
        expect(getUserMedia).not.toHaveBeenCalled();
    });

    it.each([
        { shiftKey: true }, { ctrlKey: true }, { altKey: true }, { metaKey: true },
        { isComposing: true }, { keyCode: 229 },
    ])('passes guarded DOM events through: %j', async (init) => {
        await renderHook(() => useDeskDictationControls(sessionId, {}));
        const input = sessionInput();
        expect((await key(input, 'keydown', ' ', init)).defaultPrevented).toBe(false);
        expect((await key(input, 'keydown', ' ', { ...init, repeat: true })).defaultPrevented).toBe(false);
        expect(getUserMedia).not.toHaveBeenCalled();
    });

    it('does not install hold Space on native even when a window exists', async () => {
        const previousPlatform = Platform.OS;
        Platform.OS = 'ios';
        try {
            const hook = await renderHook(() => useDeskDictationControls(sessionId, {}));
            expect((await key(sessionInput(), 'keydown')).defaultPrevented).toBe(false);
            expect(getUserMedia).not.toHaveBeenCalled();
            await hook.unmount();
        } finally {
            Platform.OS = previousPlatform;
        }
    });

    it('release is inert while idle and after an operation has already stopped', async () => {
        const hook = await renderHook(() => useDeskDictation(sessionId));
        await act(async () => { hook.getCurrent().release(); });
        expect(getUserMedia).not.toHaveBeenCalled();
        await press(hook);
        emit('result', { results: [{ transcript: 'released mic' }] });
        await act(async () => { hook.getCurrent().release(); });
        await act(async () => { hook.getCurrent().release(); });
        expect(draft()).toBe('released mic');
        expect(start).toHaveBeenCalledOnce();
    });

    it('withdraws a hold released during permission and ignores a late grant', async () => {
        let grant!: (value: { getTracks: () => [] }) => void;
        getUserMedia.mockImplementation(() => new Promise(resolve => { grant = resolve; }));
        const hook = await renderHook(() => useDeskDictationControls(sessionId, {}));
        const input = sessionInput();
        await key(input, 'keydown');
        expect(getUserMedia).toHaveBeenCalledOnce();
        await key(input, 'keyup');
        await act(async () => { grant({ getTracks: () => [] }); });
        expect(start).not.toHaveBeenCalled();
        expect(draft()).toBe('');
        expect(badge(hook.getCurrent()).tone).toBe('neutral');
    });

    it('withdraws when release and a permission grant happen in the same turn', async () => {
        let grant!: (value: { getTracks: () => [] }) => void;
        getUserMedia.mockImplementation(() => new Promise(resolve => { grant = resolve; }));
        await renderHook(() => useDeskDictationControls(sessionId, {}));
        const input = sessionInput();
        await key(input, 'keydown');
        expect(getUserMedia).toHaveBeenCalledOnce();
        await act(async () => {
            grant({ getTracks: () => [] });
            input.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', bubbles: true, cancelable: true }));
        });
        expect(start).not.toHaveBeenCalled();
        expect(draft()).toBe('');
    });

    it('Escape cancels the hold and suppresses repeats without merging or restarting', async () => {
        await renderHook(() => useDeskDictationControls(sessionId, {}));
        const input = sessionInput();
        await key(input, 'keydown');
        emit('result', { results: [{ transcript: 'discard held speech' }] });
        await key(input, 'keydown', 'Escape');
        const repeats = [];
        for (let repeat = 0; repeat < 3; repeat++) {
            repeats.push((await key(input, 'keydown', ' ', { repeat: true })).defaultPrevented);
        }
        expect((await key(input, 'keyup')).defaultPrevented).toBe(false);
        expect(abort).toHaveBeenCalledOnce();
        expect(start).toHaveBeenCalledOnce();
        expect(getUserMedia).toHaveBeenCalledOnce();
        expect(draft()).toBe('');
        expect(repeats).toEqual([true, true, true]);
        expect((await key(input, 'keydown', ' ', { repeat: true })).defaultPrevented).toBe(false);
        expect((await key(input, 'keydown')).defaultPrevented).toBe(true);
        emit('result', { results: [{ transcript: 'fresh held speech' }] });
        await key(input, 'keyup');
        expect(start).toHaveBeenCalledTimes(2);
        expect(draft()).toBe('fresh held speech');
    });

    it.each(['blur', 'hidden'])('%s clears suppression when the Space keyup is lost', async (event) => {
        await renderHook(() => useDeskDictationControls(sessionId, {}));
        const input = sessionInput();
        await key(input, 'keydown');
        emit('result', { results: [{ transcript: 'discard cancelled speech' }] });
        await key(input, 'keydown', 'Escape');
        await act(async () => {
            if (event === 'blur') window.dispatchEvent(new Event('blur'));
            else {
                vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
                document.dispatchEvent(new Event('visibilitychange'));
            }
        });
        expect((await key(input, 'keydown', ' ', { repeat: true })).defaultPrevented).toBe(false);
        expect(start).toHaveBeenCalledOnce();
        expect(draft()).toBe('');
    });

    it.each(['blur', 'hidden'])('%s releases the hold and merges', async (event) => {
        await renderHook(() => useDeskDictationControls(sessionId, {}));
        const input = sessionInput();
        await key(input, 'keydown');
        emit('result', { results: [{ transcript: 'keep held speech' }] });
        await act(async () => {
            if (event === 'blur') window.dispatchEvent(new Event('blur'));
            else {
                vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
                document.dispatchEvent(new Event('visibilitychange'));
            }
        });
        await key(input, 'keyup');
        expect(draft()).toBe('keep held speech');
        expect(start).toHaveBeenCalledOnce();
    });

    it('can disable hold Space while keeping the mic working', async () => {
        const hook = await renderHook(() => useDeskDictationControls(sessionId, {}, { holdSpace: false }));
        const input = sessionInput();
        expect((await key(input, 'keydown')).defaultPrevented).toBe(false);
        expect((await key(input, 'keydown', ' ', { repeat: true })).defaultPrevented).toBe(false);
        expect(getUserMedia).not.toHaveBeenCalled();
        await act(async () => { badge(hook.getCurrent()).onPress?.(); });
        expect(badge(hook.getCurrent()).tone).toBe('active');
        emit('result', { results: [{ transcript: 'mic still works' }] });
        await act(async () => { badge(hook.getCurrent()).onPress?.(); });
        expect(draft()).toBe('mic still works');
    });

    it('Space cannot take over a mic-started operation', async () => {
        const hook = await renderHook(() => useDeskDictationControls(sessionId, {}));
        const input = sessionInput();
        await act(async () => { badge(hook.getCurrent()).onPress?.(); });
        expect((await key(input, 'keydown')).defaultPrevented).toBe(false);
        for (let repeat = 0; repeat < 3; repeat++) {
            expect((await key(input, 'keydown', ' ', { repeat: true })).defaultPrevented).toBe(false);
        }
        expect((await key(input, 'keyup')).defaultPrevented).toBe(false);
        expect(start).toHaveBeenCalledOnce();
        expect(getUserMedia).toHaveBeenCalledOnce();
        expect(badge(hook.getCurrent()).tone).toBe('active');
        expect(badge(hook.getCurrent()).label).not.toContain(t('ignorePrevious.dictation.listeningHoldSpace'));
        emit('result', { results: [{ transcript: 'mic speech' }] });
        await act(async () => { badge(hook.getCurrent()).onPress?.(); });
        expect(draft()).toBe('mic speech');
    });

    it('does not start the mic when Space begins on a tab and remains held into the composer', async () => {
        await renderHook(() => useDeskDictationControls(sessionId, {}));
        const tab = document.createElement('div');
        tab.setAttribute('role', 'tab'); tab.tabIndex = 0;
        document.body.append(tab); tab.focus();
        await key(tab, 'keydown');
        const input = sessionInput(); input.focus();
        await key(input, 'keydown', ' ', { repeat: true });
        await key(input, 'keyup');
        expect(getUserMedia).not.toHaveBeenCalled();
        expect(start).not.toHaveBeenCalled();
        expect(draft()).toBe('');
        tab.remove();
    });

    it('passes repeats through when Space was held elsewhere before focusing the empty input', async () => {
        await renderHook(() => useDeskDictationControls(sessionId, {}));
        const input = sessionInput();
        const elsewhere = document.createElement('textarea');
        document.body.append(elsewhere);
        elsewhere.focus();
        expect((await key(elsewhere, 'keydown')).defaultPrevented).toBe(false);
        input.focus();
        for (let repeat = 0; repeat < 3; repeat++) {
            expect((await key(input, 'keydown', ' ', { repeat: true })).defaultPrevented).toBe(false);
        }
        expect((await key(input, 'keyup')).defaultPrevented).toBe(false);
        expect(getUserMedia).not.toHaveBeenCalled();
        expect(start).not.toHaveBeenCalled();
        expect(draft()).toBe('');
    });

    it('unmount during suppression removes listeners and leaves a remount idle', async () => {
        const hook = await renderHook(() => useDeskDictationControls(sessionId, {}));
        const input = sessionInput();
        await key(input, 'keydown');
        emit('result', { results: [{ transcript: 'discard unmounted suppression' }] });
        await key(input, 'keydown', 'Escape');
        expect((await key(input, 'keydown', ' ', { repeat: true })).defaultPrevented).toBe(true);
        await hook.unmount();
        expect((await key(input, 'keydown', ' ', { repeat: true })).defaultPrevented).toBe(false);
        await renderHook(() => useDeskDictationControls(sessionId, {}));
        expect((await key(input, 'keydown', ' ', { repeat: true })).defaultPrevented).toBe(false);
        expect(start).toHaveBeenCalledOnce();
        expect(draft()).toBe('');
        await key(input, 'keyup');
        expect((await key(input, 'keydown')).defaultPrevented).toBe(true);
        emit('result', { results: [{ transcript: 'remounted hold' }] });
        await key(input, 'keyup');
        expect(start).toHaveBeenCalledTimes(2);
        expect(draft()).toBe('remounted hold');
    });

    it('unmount removes keyboard listeners and cancels the active hold', async () => {
        const hook = await renderHook(() => useDeskDictationControls(sessionId, {}));
        const input = sessionInput();
        await key(input, 'keydown');
        emit('result', { results: [{ transcript: 'discard unmounted hold' }] });
        await hook.unmount();
        await key(input, 'keyup');
        expect((await key(input, 'keydown')).defaultPrevented).toBe(false);
        expect(getUserMedia).toHaveBeenCalledOnce();
        expect(abort).toHaveBeenCalledOnce();
        expect(draft()).toBe('');
    });

    it.each([false, true])('session change suppresses the interrupted hold, already cancelled=%s', async (alreadyCancelled) => {
        writeExistingSessionDraft({ scope, sessionId: 'another-coordinator', patch: { text: '' } });
        const hook = await renderHook(({ id }) => useDeskDictationControls(id, {}), { initialProps: { id: sessionId } });
        const input = sessionInput();
        await key(input, 'keydown');
        emit('result', { results: [{ transcript: 'old held speech' }] });
        if (alreadyCancelled) await key(input, 'keydown', 'Escape');
        await hook.rerender({ id: 'another-coordinator' });
        const repeats = [];
        for (let repeat = 0; repeat < 3; repeat++) {
            repeats.push((await key(input, 'keydown', ' ', { repeat: true })).defaultPrevented);
        }
        expect((await key(input, 'keyup')).defaultPrevented).toBe(false);
        expect(abort).toHaveBeenCalledOnce();
        expect(getUserMedia).toHaveBeenCalledOnce();
        expect(start).toHaveBeenCalledOnce();
        expect(draft()).toBe('');
        expect(draft('another-coordinator')).toBe('');
        expect(repeats).toEqual([true, true, true]);
        await key(input, 'keydown');
        emit('result', { results: [{ transcript: 'new held speech' }] });
        await key(input, 'keyup');
        expect(getUserMedia).toHaveBeenCalledTimes(2);
        expect(draft()).toBe('');
        expect(draft('another-coordinator')).toBe('new held speech');
    });
});
