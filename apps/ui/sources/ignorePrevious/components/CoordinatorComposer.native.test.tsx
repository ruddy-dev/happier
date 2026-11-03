import * as React from 'react';
import { act } from 'react-test-renderer';
import { expect, it, vi } from 'vitest';
import { renderScreen } from '@/dev/testkit';
import { installFormsCommonModuleMocks } from '@/components/ui/forms/formsTestHelpers';
import type { MultiTextInputHandle } from '@/components/ui/forms/MultiTextInput';
import { CoordinatorComposerInputContext, createCoordinatorComposerObserver } from '../model/coordinatorComposerInput';

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
