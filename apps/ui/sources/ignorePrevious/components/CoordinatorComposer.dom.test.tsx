/** @vitest-environment jsdom */
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MultiTextInput, type MultiTextInputHandle } from '@/components/ui/forms/MultiTextInput.web';
import { createSessionFixture } from '@/dev/testkit/fixtures/sessionFixtures';
import { storage } from '@/sync/domains/state/storage';
import { t } from '@/text';
import { deskPrefs } from '../deskPrefs';
import { CoordinatorComposer } from './CoordinatorComposer';

vi.mock('react-native', async () => vi.importActual('react-native-web'));
// Vitest does not perform Metro's web extension resolution for the fixture's platform input.
vi.mock('@/components/ui/forms/MultiTextInput', async () => vi.importActual('@/components/ui/forms/MultiTextInput.web'));
vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock();
});
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let before: ReturnType<typeof storage.getState>;
const handle = React.createRef<MultiTextInputHandle>();
const secondHandle = React.createRef<MultiTextInputHandle>();
const searchHandle = React.createRef<MultiTextInputHandle>();

function Input({ value = '', inputRef = handle, testID = 'session-composer-input' }: {
    value?: string; inputRef?: React.RefObject<MultiTextInputHandle | null>; testID?: string;
}) {
    const [draft, setDraft] = React.useState(value);
    React.useEffect(() => setDraft(value), [value]);
    return <MultiTextInput ref={inputRef} value={draft} onChangeText={setDraft} testID={testID} />;
}
const render = (value = '', session = 'coordinator') => act(async () => root.render(
    <CoordinatorComposer key={session}><Input value={value} /></CoordinatorComposer>,
));
const find = (id: string) => container.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const status = () => find('ip-composer-draft-status')?.textContent;
const position = () => find('ip-composer-position')?.textContent;

beforeEach(() => {
    before = storage.getState();
    deskPrefs.set('chatStyle', 'terminal');
    container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
    await act(async () => root.unmount()); container.remove(); storage.setState(before, true);
    deskPrefs.set('chatStyle', 'mask');
});

it('R45 keeps the real global waits summary visible on empty drafts, including cold-load unknown and unloaded requests', async () => {
    storage.setState({ sessions: {}, sessionListRenderables: {}, isDataReady: false });
    await render();
    expect(status()).toBe(t('ignorePrevious.composer.ready'));
    expect(find('ip-composer-waiting')?.textContent).toBe(t('ignorePrevious.composer.waitingUnknown'));
    expect(find('ip-composer-position')).toBeNull();
    await act(async () => {
        storage.getState().applySessions([
            createSessionFixture({ id: 'coordinator', active: true, pendingPermissionRequestCount: 1 }),
            createSessionFixture({ id: 'worker', active: true, pendingUserActionRequestCount: 1 }),
        ]);
        storage.getState().applyReady();
    });
    expect(find('ip-composer-waiting')?.textContent).toBe(t('ignorePrevious.composer.waiting', { count: 2 }));
    await act(async () => storage.getState().deleteSessions(['coordinator', 'worker']));
    expect(find('ip-composer-waiting')?.textContent).toBe(t('ignorePrevious.composer.waiting', { count: 0 }));
});

it('R45 reads pasted text, keyboard and backward mouse selection, imperative edits and external clear/replacement', async () => {
    await render();
    const input = handle.current!.getInputElement()!;
    await act(async () => {
        input.focus();
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, 'first\nsecond');
        input.setSelectionRange(9, 9);
        input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste' }));
    });
    expect(status()).toBe(t('ignorePrevious.composer.writing'));
    expect(position()).toBe(t('ignorePrevious.composer.position', { line: 2, column: 4 }));
    await act(async () => {
        input.setSelectionRange(0, 8, 'backward');
        document.dispatchEvent(new Event('selectionchange', { bubbles: true }));
    });
    expect(position()).toBe(t('ignorePrevious.composer.position', { line: 1, column: 1 }));
    await act(async () => handle.current!.setSelection({ start: 7, end: 7 }));
    expect(position()).toBe(t('ignorePrevious.composer.position', { line: 2, column: 2 }));
    await act(async () => handle.current!.setTextAndSelection('single line', { start: 2, end: 2 }));
    expect(status()).toBe(t('ignorePrevious.composer.writing')); expect(find('ip-composer-position')).toBeNull();
    await render('replacement\nnext');
    expect(position()).toBe(t('ignorePrevious.composer.position', { line: 2, column: 5 }));
    await render('');
    expect(status()).toBe(t('ignorePrevious.composer.ready')); expect(find('ip-composer-position')).toBeNull();
    await render('restored\ndraft', 'another-session');
    expect(status()).toBe(t('ignorePrevious.composer.writing'));
    expect(position()).toBe(t('ignorePrevious.composer.position', { line: 1, column: 1 }));
});

it('R45 isolates two panes and ignores non-composer inputs and ordinary Happier inputs', async () => {
    await act(async () => root.render(<>
        <section data-pane="one"><CoordinatorComposer><Input /><Input inputRef={searchHandle} testID="search" /></CoordinatorComposer></section>
        <section data-pane="two"><CoordinatorComposer><Input inputRef={secondHandle} /></CoordinatorComposer></section>
        <Input testID="plain" inputRef={React.createRef()} />
    </>));
    await act(async () => handle.current!.setTextAndSelection('one\ntwo', { start: 1, end: 1 }));
    const states = container.querySelectorAll('[data-testid="ip-composer-draft-status"]');
    expect([...states].map(node => node.textContent)).toEqual([t('ignorePrevious.composer.writing'), t('ignorePrevious.composer.ready')]);
    expect(container.querySelector('[data-pane="one"] [data-testid="ip-composer-position"]')?.textContent)
        .toBe(t('ignorePrevious.composer.position', { line: 1, column: 2 }));
    expect(container.querySelectorAll('[data-testid="ip-composer-prompt"]')).toHaveLength(2);
    await act(async () => {
        handle.current!.setTextAndSelection('', { start: 0, end: 0 });
        searchHandle.current!.setTextAndSelection('not a draft', { start: 1, end: 1 });
        secondHandle.current!.setTextAndSelection('second', { start: 2, end: 2 });
    });
    expect([...states].map(node => node.textContent)).toEqual([t('ignorePrevious.composer.ready'), t('ignorePrevious.composer.writing')]);
    await act(async () => deskPrefs.set('chatStyle', 'mask'));
    expect(find('ip-composer-status-strip')).toBeNull(); expect(find('ip-composer-prompt')).toBeNull();
});

it('R45 keeps draft, cursor and global waits subscriptions out of the transcript', async () => {
    const Transcript = vi.fn(() => <div>Transcript</div>);
    await act(async () => root.render(<CoordinatorComposer><Transcript /><Input /></CoordinatorComposer>));
    await act(async () => handle.current!.setTextAndSelection('first\nsecond', { start: 8, end: 8 }));
    await act(async () => handle.current!.setSelection({ start: 9, end: 9 }));
    await act(async () => {
        storage.getState().applySessions([createSessionFixture({ id: 'worker', active: true, pendingPermissionRequestCount: 1 })]);
        storage.getState().applyReady();
    });
    expect(position()).toBe(t('ignorePrevious.composer.position', { line: 2, column: 4 }));
    expect(find('ip-composer-waiting')?.textContent).toBe(t('ignorePrevious.composer.waiting', { count: 1 }));
    expect(Transcript).toHaveBeenCalledTimes(1);
});

it('R45 gives the screenshot fixture the shared editable Terminal prompt and status without sending anything', async () => {
    const { CoordinatorBodyStub } = await import('../fixtures/CoordinatorBodyStub');
    await act(async () => root.render(<CoordinatorComposer><CoordinatorBodyStub
        footerLeadingActions={<button data-testid="fixture-controls">Controls</button>}
        statusTrailingActions={<span data-testid="fixture-context">Context</span>} />
    </CoordinatorComposer>));
    const input = container.querySelector<HTMLTextAreaElement>('[data-testid="session-composer-input"]');
    expect(input).not.toBeNull();
    expect(find('ip-composer-prompt')).not.toBeNull();
    expect(find('fixture-controls')).not.toBeNull(); expect(find('fixture-context')).not.toBeNull();
    await act(async () => {
        input!.focus();
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, 'preview\ntext');
        input!.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
    });
    expect(status()).toBe(t('ignorePrevious.composer.writing'));
    expect(position()).toBe(t('ignorePrevious.composer.position', { line: 2, column: 5 }));
    await act(async () => find('session-composer-send')!.click());
    expect(status()).toBe(t('ignorePrevious.composer.ready'));
});

it('R45 reports column one before a leading newline', async () => {
    await render();
    await act(async () => handle.current!.setTextAndSelection('\nnext', { start: 0, end: 0 }));
    expect(position()).toBe(t('ignorePrevious.composer.position', { line: 1, column: 1 }));
});

it('R45 follows cancelled IME text', async () => {
    await render('first\nsecond');
    const input = handle.current!.getInputElement()!;
    await act(async () => {
        input.focus();
        input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, 'first\nsecond interim');
        input.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }));
    });
    expect(status()).toBe(t('ignorePrevious.composer.writing'));
    expect(position()).toBe(t('ignorePrevious.composer.position', { line: 2, column: 15 }));
    await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, 'first\nsecond');
        input.setSelectionRange(0, 0);
        input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
    });
    expect(position()).toBe(t('ignorePrevious.composer.position', { line: 1, column: 1 }));
});
