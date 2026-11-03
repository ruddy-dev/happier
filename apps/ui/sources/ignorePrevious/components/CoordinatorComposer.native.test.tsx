import * as React from 'react';
import { act } from 'react-test-renderer';
import { expect, it, vi } from 'vitest';
import { renderScreen } from '@/dev/testkit';
import { installFormsCommonModuleMocks } from '@/components/ui/forms/formsTestHelpers';
import type { MultiTextInputHandle } from '@/components/ui/forms/MultiTextInput';
import { CoordinatorComposerInputContext, createCoordinatorComposerObserver } from '../model/coordinatorComposerInput';
import { readComposerText, registerComposerRequestHandle, useComposerRequestHandle } from '@/components/sessions/model/composerRequests';

vi.mock('@/sync/store/hooks', () => ({ useLocalSetting: () => 1 }));
installFormsCommonModuleMocks({ reactNative: async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock({ Platform: { OS: 'ios' }, View: 'View', TextInput: (props: object) => React.createElement('TextInput', props) });
} });

it('observes the native composer draft and places the row at the real panel, without observing other inputs', async () => {
    const { MultiTextInput } = await import('@/components/ui/forms/MultiTextInput');
    const { WebDropTargetView } = await import('@/components/sessions/files/repositoryTree/WebDropTargetView');
    const ref = React.createRef<MultiTextInputHandle>();
    const observer = createCoordinatorComposerObserver();
    function Row() {
        const writing = React.useSyncExternalStore(observer.subscribe, () => observer.getSnapshot().writing);
        return writing ? null : React.createElement('row');
    }
    function Composer({ value, id = 'session-composer-input' }: { value: string; id?: string }) {
        return <CoordinatorComposerInputContext.Provider value={{ observer, prompt: null, panelFooter: null, panelLeading: <Row /> }}>
            <WebDropTargetView testID="agent-input-drop-zone"><MultiTextInput ref={ref} testID={id} value={value} onChangeText={() => {}} /></WebDropTargetView>
        </CoordinatorComposerInputContext.Provider>;
    }
    const screen = await renderScreen(<Composer value="hydrated" />);
    expect(screen.tree.root.findAllByType('row' as never)).toHaveLength(0);
    await screen.update(<Composer value="" />);
    expect(screen.tree.root.findAllByType('row' as never)).toHaveLength(1);
    await screen.update(<Composer value="restored draft" />);
    expect(screen.tree.root.findAllByType('row' as never)).toHaveLength(0);
    await screen.update(<Composer value="" />);
    expect(screen.tree.root.findAllByType('row' as never)).toHaveLength(1);
    const input = () => screen.tree.root.findByType('TextInput' as never);
    await act(async () => input().props.onChangeText(' '));
    expect(screen.tree.root.findAllByType('row' as never)).toHaveLength(0);
    await act(async () => input().props.onChangeText(' composing'));
    expect(screen.tree.root.findAllByType('row' as never)).toHaveLength(0);
    await act(async () => input().props.onChangeText(''));
    expect(screen.tree.root.findAllByType('row' as never)).toHaveLength(1);
    await act(async () => ref.current!.setTextAndSelection('draft', { start: 5, end: 5 }));
    expect(screen.tree.root.findAllByType('row' as never)).toHaveLength(0);
    await screen.update(<Composer value="" key="next-session" />);
    expect(screen.tree.root.findAllByType('row' as never)).toHaveLength(1);
    await screen.update(<Composer value="" id="other-input" />);
    await act(async () => input().props.onChangeText('unrelated'));
    expect(screen.tree.root.findAllByType('row' as never)).toHaveLength(1);
});

it('keeps a regular native input outside a desk provider unchanged', async () => {
    const { MultiTextInput } = await import('@/components/ui/forms/MultiTextInput');
    const onChangeText = vi.fn();
    const screen = await renderScreen(<MultiTextInput testID="session-composer-input" value="ordinary" onChangeText={onChangeText} />);
    const input = screen.tree.root.findByType('TextInput' as never);
    expect(input.props.value).toBe('ordinary');
    await act(async () => input.props.onChangeText('ordinary edit'));
    expect(onChangeText).toHaveBeenCalledWith('ordinary edit');
});

it('keeps the actual native input and session descendants mounted across the phone breakpoint', async () => {
    const { CoordinatorComposer } = await import('./CoordinatorComposer');
    const { MultiTextInput } = await import('@/components/ui/forms/MultiTextInput');
    const { WebDropTargetView } = await import('@/components/sessions/files/repositoryTree/WebDropTargetView');
    const mounts = vi.fn();
    const unmounts = vi.fn();
    const ref = React.createRef<MultiTextInputHandle>();
    function Session() {
        const [draft, setDraft] = React.useState('queued edit');
        const [attachment] = React.useState('attachment');
        const [sendState] = React.useState('editing pending message');
        React.useEffect(() => { mounts(); return () => { unmounts(); }; }, []);
        return <WebDropTargetView testID="agent-input-drop-zone">
            <MultiTextInput ref={ref} testID="session-composer-input" value={draft} onChangeText={setDraft} />
            <ViewForTest attachment={attachment} sendState={sendState} />
        </WebDropTargetView>;
    }
    function ViewForTest(props: { attachment: string; sendState: string }) { return React.createElement('session-state', props); }
    const tree = (phone: boolean) => <CoordinatorComposer coordinatorId="fixture-coordinator" phone={phone}><Session /></CoordinatorComposer>;
    const screen = await renderScreen(tree(true));
    const input = screen.tree.root.findByType('TextInput' as never);
    await screen.update(tree(false));
    expect(screen.findByTestId('ip-phone-shortcuts')).toBeNull();
    await screen.update(tree(true));
    expect(screen.tree.root.findByType('TextInput' as never) === input).toBe(true);
    expect(ref.current).not.toBeNull();
    expect(ref.current?.getText()).toBe('queued edit');
    expect(screen.tree.root.findByType('session-state' as never).props).toMatchObject({ attachment: 'attachment', sendState: 'editing pending message' });
    expect(mounts).toHaveBeenCalledTimes(1);
    expect(unmounts).not.toHaveBeenCalled();
    await screen.update(tree(false));
    await act(async () => screen.tree.root.findByType('TextInput' as never).props.onChangeText(''));
    await screen.update(tree(true));
    expect(screen.findByTestId('ip-phone-shortcuts')).toBeTruthy();
    expect(mounts).toHaveBeenCalledTimes(1);
    await act(async () => screen.tree.unmount());
    expect(unmounts).toHaveBeenCalledTimes(1);
});

it('routes the first shortcut press through the real native row to its own composer', async () => {
    const { CoordinatorComposer } = await import('./CoordinatorComposer');
    const { MultiTextInput } = await import('@/components/ui/forms/MultiTextInput');
    const { WebDropTargetView } = await import('@/components/sessions/files/repositoryTree/WebDropTargetView');
    const focus = vi.fn();
    const ref = React.createRef<MultiTextInputHandle>();
    function Session() {
        const [draft, setDraft] = React.useState('');
        useComposerRequestHandle('fixture-coordinator', {
            getText: () => ref.current?.getText() ?? '',
            setText: (text) => { ref.current?.setTextAndSelection(text, { start: text.length, end: text.length }); setDraft(text); },
            focus,
        }, true);
        return <WebDropTargetView testID="agent-input-drop-zone"><MultiTextInput ref={ref} testID="session-composer-input" value={draft} onChangeText={setDraft} /></WebDropTargetView>;
    }
    const screen = await renderScreen(<CoordinatorComposer coordinatorId="fixture-coordinator" phone><Session /></CoordinatorComposer>);
    const row = screen.findByTestId('ip-phone-shortcuts');
    expect(row?.props.keyboardShouldPersistTaps).toBe('handled');
    await screen.pressByTestIdAsync('ip-brief-first');
    expect(ref.current?.getText()).toBe('ignorePrevious.composer.briefPrompt');
    expect(focus).toHaveBeenCalledTimes(1);
    expect(screen.findByTestId('ip-phone-shortcuts')).toBeNull();
    await act(async () => screen.tree.unmount());
});

it('does not re-register a session composer when crossing the breakpoint', async () => {
    const { CoordinatorComposer } = await import('./CoordinatorComposer');
    function Session() {
        useComposerRequestHandle('fixture-registration', { getText: () => 'first', setText: () => {}, focus: () => {} }, true);
        return null;
    }
    const tree = (phone: boolean) => <CoordinatorComposer coordinatorId="fixture-registration" phone={phone}><Session /></CoordinatorComposer>;
    const screen = await renderScreen(tree(true));
    const unregister = registerComposerRequestHandle('fixture-registration', { getText: () => 'later', setText: () => {}, focus: () => {} });
    try {
        await screen.update(tree(false));
        await screen.update(tree(true));
        expect(readComposerText('fixture-registration')).toBe('later');
        unregister();
        expect(readComposerText('fixture-registration')).toBe('first');
        await act(async () => screen.tree.unmount());
        expect(readComposerText('fixture-registration')).toBeNull();
    } finally {
        unregister();
    }
});
