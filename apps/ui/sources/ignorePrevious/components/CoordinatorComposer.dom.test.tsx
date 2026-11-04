/** @vitest-environment jsdom */
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { AppPaneProvider } from '@/components/appShell/panes/AppPaneProvider';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { AgentInput } from '@/components/sessions/agentInput/AgentInput';
import { AgentInputChipLabel } from '@/components/sessions/agentInput/components/AgentInputChipLabel';
import { WebDropTargetView } from '@/components/sessions/files/repositoryTree/WebDropTargetView';
import { RunSettingsMenu } from './RunSettingsMenu';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MultiTextInput, type MultiTextInputHandle } from '@/components/ui/forms/MultiTextInput.web';
import { createSessionFixture } from '@/dev/testkit/fixtures/sessionFixtures';
import { storage } from '@/sync/domains/state/storage';
import { t } from '@/text';
import { apiSocket } from '@/sync/api/session/apiSocket';
import { applyDeskFixture } from '../fixtures/applyDeskFixture';
import { DeskDemoContext } from '../deskFixtureGate';
import demo from '../fixtures/demo/desk-demo.json';
import { getDemoConversation } from '../fixtures/demoConversation';
import { installAgentAssetLoader } from '@/dev/testkit/mocks/agentAssets';
import { deskPrefs } from '../deskPrefs';
import { CoordinatorComposer } from './CoordinatorComposer';
import { CoordinatorPrompts } from './CoordinatorPrompts';
import { DeskPaintContext, deskThemes, useDeskPaint } from '../palette';
import { useUnistyles } from 'react-native-unistyles';
import { lightTheme, darkTheme } from '@/theme';

// Keep the real web hosts and Animated.Value; RN Web lacks RN's hook.
vi.mock('react-native', async () => {
    const web = await vi.importActual<typeof import('react-native')>('react-native-web');
    return { ...web, useAnimatedValue: (value: number) => React.useRef(new web.Animated.Value(value)).current };
});
vi.mock('@react-navigation/native', () => ({ useIsFocused: () => true }));
vi.mock('@/modal', async () => {
    const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
    return createModalModuleMock().module;
});
// Vitest does not perform Metro's web extension resolution for the fixture's platform input.
vi.mock('@/components/ui/forms/MultiTextInput', async () => vi.importActual('@/components/ui/forms/MultiTextInput.web'));
vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock();
});
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let releaseFixture: (() => void) | undefined;
let before: ReturnType<typeof storage.getState>;
const handle = React.createRef<MultiTextInputHandle>();
const secondHandle = React.createRef<MultiTextInputHandle>();
const searchHandle = React.createRef<MultiTextInputHandle>();

function Input({ value = '', inputRef = handle, testID = 'session-composer-input' }: {
    value?: string; inputRef?: React.RefObject<MultiTextInputHandle | null>; testID?: string;
}) {
    const [draft, setDraft] = React.useState(value);
    React.useEffect(() => setDraft(value), [value]);
    return <WebDropTargetView testID={testID === 'session-composer-input' ? 'agent-input-drop-zone' : 'other-drop-zone'}>
        <MultiTextInput ref={inputRef} value={draft} onChangeText={setDraft} testID={testID} />
    </WebDropTargetView>;
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
    storage.getState().applySettingsLocal({ agentInputActionBarLayout: 'wrap' });
    container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
    await act(async () => { await root.unmount(); releaseFixture?.(); });
    container.remove(); releaseFixture = undefined; storage.setState(before, true);
    deskPrefs.set('chatStyle', 'mask');
    deskPrefs.set('terminalPalette', 'tokyo');
    Object.assign(useUnistyles().theme, lightTheme);
    vi.restoreAllMocks(); vi.unstubAllGlobals();
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

const safeArea = { top: 0, right: 0, bottom: 0, left: 0 };
const noSend = () => {};
const noSuggestions = async () => [];
function RealComposer({ visible = true, draft = '', desk = true, phone = false, locationControls = false }: { visible?: boolean; draft?: string; desk?: boolean; phone?: boolean; locationControls?: boolean }) {
    const input = visible ? <AgentInput sessionId="coordinator" value={draft} onChangeText={() => {}} onSend={noSend}
        onPathClick={locationControls ? noSend : undefined} currentPath={locationControls ? '/tmp' : undefined}
        placeholder={t('ignorePrevious.composer.placeholder')} autocompleteKinds={[]} autocompleteSuggestions={noSuggestions}
        footerLeadingActions={<RunSettingsMenu />} statusTrailingActions={<span data-testid="fixture-context">Context</span>} />
        : <div data-testid="session-unavailable" />;
    return <SafeAreaInsetsContext.Provider value={safeArea}>
        {desk ? <CoordinatorComposer phone={phone}>{input}</CoordinatorComposer> : input}
    </SafeAreaInsetsContext.Provider>;
}

function Paint({ children, name }: React.PropsWithChildren<{ name: 'night' | 'paper' }>) {
    const paint = useDeskPaint();
    return <DeskPaintContext.Provider value={{ ...paint, paint: deskThemes[name] }}>{children}</DeskPaintContext.Provider>;
}

// jsdom has no layout. Supply only scroll geometry at the existing RN Web host
// boundary; keep AgentInput, its scroll owner, fades and indicators real.
async function overflowActionRows() {
    const footer = find('agent-input-action-footer')!;
    const scrollers = [...footer.querySelectorAll<HTMLElement>('div')].filter(node => getComputedStyle(node).overflowX === 'auto');
    expect(scrollers.length).toBeGreaterThan(0);
    for (const scroller of scrollers) Object.defineProperties(scroller, {
        clientWidth: { configurable: true, value: 200 },
        scrollWidth: { configurable: true, value: 624 },
        scrollLeft: { configurable: true, writable: true, value: 100 },
    });
    await act(async () => window.dispatchEvent(new Event('resize')));
    return scrollers.map(scroller => scroller.parentElement!);
}

function expectEdgePaint(rows: HTMLElement[], background: string, ink: string) {
    for (const row of rows) {
        const gradients = [...row.querySelectorAll('lineargradient')];
        expect(gradients).toHaveLength(2);
        expect(gradients[0].getAttribute('colors')?.split(',')[0]).toBe(background);
        expect(gradients[1].getAttribute('colors')?.endsWith(`,${background}`)).toBe(true);
        const indicators = row.querySelectorAll('icon[name="caret-left"], icon[name="caret-right"]');
        expect(indicators).toHaveLength(2);
        for (const indicator of indicators) expect(indicator.getAttribute('color')).toBe(ink);
    }
}

it.each([
    ['terminal', 'night', 'tokyo', 'light'],
    ['terminal', 'paper', 'terminalPaper', 'dark'],
    ['mask', 'night', 'tokyo', 'light'],
    ['mask', 'paper', 'terminalPaper', 'dark'],
] as const)('pairs mounted %s %s action fades and chevrons for %s over the opposing %s app palette', async (style, name, palette, appTheme) => {
    Object.assign(useUnistyles().theme, appTheme === 'light' ? lightTheme : darkTheme);
    storage.getState().applySettingsLocal({ agentInputActionBarLayout: 'scroll' });
    deskPrefs.set('chatStyle', style); deskPrefs.set('terminalPalette', palette);
    await act(async () => root.render(<Paint name={name}><RealComposer phone locationControls /></Paint>));
    const paint = style === 'terminal' ? deskThemes[palette] : deskThemes[name];
    const background = style === 'mask' && name === 'paper' ? paint.panel2 : paint.bg;
    // jsdom cannot resolve Terminal's scoped !important rule over RN Web's
    // inline background. Slip uses the real panelStyle binding instead.
    if (style === 'mask') {
        const css = document.createElement('span').style;
        css.backgroundColor = background;
        expect(getComputedStyle(find('agent-input-drop-zone')!).backgroundColor).toBe(css.backgroundColor);
    }
    const rows = await overflowActionRows();
    expect(rows).toHaveLength(2);
    expectEdgePaint(rows, background, paint.ink);

    // Changing the selected palette must update existing fades without a remount.
    const input = find('session-composer-input');
    await act(async () => {
        deskPrefs.set('chatStyle', 'terminal');
        deskPrefs.set('terminalPalette', palette === 'tokyo' ? 'terminalPaper' : 'tokyo');
    });
    const next = palette === 'tokyo' ? deskThemes.terminalPaper : deskThemes.tokyo;
    expect(find('session-composer-input')).toBe(input);
    expectEdgePaint(await overflowActionRows(), next.bg, next.ink);
});

it.each(['standard', 'glass'] as const)('retains ordinary %s composer fade and indicator theme paint outside the desk context', async (surface) => {
    storage.getState().applySettingsLocal({ agentInputActionBarLayout: 'scroll', composerSurfaceStyle: surface });
    await act(async () => root.render(<RealComposer desk={false} locationControls />));
    const { theme } = useUnistyles();
    const rows = await overflowActionRows();
    expect(rows).toHaveLength(2);
    expectEdgePaint(rows, surface === 'glass' ? theme.colors.surface.base : theme.colors.input.background, theme.colors.composer.chipTint);
});

it.each(['night', 'paper'] as const)('keeps the real %s Slip textarea mono and palette-aware, isolated from ordinary Happier', async (name) => {
    await act(async () => root.render(<RealComposer desk={false} />));
    const textarea = () => container.querySelector<HTMLTextAreaElement>('[data-testid="session-composer-input"]')!;
    const ordinaryFont = textarea().style.fontFamily;
    const ordinaryInk = textarea().style.color;
    expect(ordinaryFont).not.toContain('JetBrains Mono');
    const css = document.createElement('span').style;

    deskPrefs.set('chatStyle', 'mask');
    await act(async () => root.render(<Paint name={name}><RealComposer /></Paint>));
    const box = find('agent-input-drop-zone')!;
    css.backgroundColor = name === 'paper' ? deskThemes.paper.panel2 : deskThemes.night.bg;
    expect(getComputedStyle(box).backgroundColor).toBe(css.backgroundColor);
    expect(getComputedStyle(box).borderTopLeftRadius).toBe('18px');
    expect(getComputedStyle(box).borderBottomLeftRadius).toBe('8px');
    // Inspect the real textarea's inline binding; jsdom's computed font shorthand is unreliable.
    expect(textarea().style.fontFamily).toContain('JetBrains Mono');
    css.color = deskThemes[name].ink;
    expect(textarea().style.color).toBe(css.color);
    expect(find('ip-composer-status-strip')).toBeNull();

    const terminalPaint = name === 'paper' ? deskThemes.terminalPaper : deskThemes.tokyo;
    await act(async () => {
        deskPrefs.set('terminalPalette', name === 'paper' ? 'terminalPaper' : 'tokyo');
        deskPrefs.set('chatStyle', 'terminal');
    });
    expect(textarea().style.fontFamily).toContain('JetBrains Mono');
    css.color = terminalPaint.ink;
    expect(textarea().style.color).toBe(css.color);
    expect(find('ip-composer-status-strip')).not.toBeNull();

    await act(async () => root.render(<RealComposer desk={false} />));
    expect(textarea().style.fontFamily).toBe(ordinaryFont);
    expect(textarea().style.color).toBe(ordinaryInk);
    expect(find('ip-composer-status-strip')).toBeNull();
});

it('renders real Terminal mode captions in the desk mono bracket language', async () => {
    releaseFixture = applyDeskFixture();
    await renderFixture(false, true);
    const mode = find('agent-input-session-mode-chip')!;
    const permission = find('agent-input-permission-chip')!;
    expect(mode.textContent).toContain('[Plan]');
    expect(permission.textContent).toMatch(/\[.+\]/);
    // jsdom miscomputes RN Web's class-level font shorthand against this inline longhand.
    expect(mode.querySelector<HTMLElement>('[data-testid^="agent-input-session-mode-chip-label:"]')!.style.fontFamily).toContain('JetBrains Mono');
});

it('keeps counted control labels and desk palette scoped to the coordinator', async () => {
    await act(async () => root.render(<>
        <section data-owner="desk"><CoordinatorComposer><AgentInputChipLabel label="Tools" count={3} /></CoordinatorComposer></section>
        <section data-owner="ordinary"><AgentInputChipLabel label="Tools" count={3} /></section>
    </>));
    const desk = container.querySelector<HTMLElement>('[data-owner="desk"]')!;
    const ordinary = container.querySelector<HTMLElement>('[data-owner="ordinary"]')!;
    const deskLabel = [...desk.querySelectorAll<HTMLElement>('*')].find((element) => element.textContent === '[Tools (3)]' && element.style.fontFamily.includes('JetBrains Mono'))!;
    expect(deskLabel.textContent).toBe('[Tools (3)]');
    expect(ordinary.textContent).toBe('Tools (3)');
    expect(deskLabel.style.fontFamily).toContain('JetBrains Mono');
    await act(async () => deskPrefs.set('chatStyle', 'mask'));
    expect(deskLabel.textContent).toBe('Tools (3)');
    expect(ordinary.textContent).toBe('Tools (3)');
});

it.each(['scroll', 'wrap'] as const)('keeps populated phone controls and send together below the run control in %s mode', async (layout) => {
    storage.getState().applySettingsLocal({ agentInputActionBarLayout: layout });
    releaseFixture = applyDeskFixture();
    await renderFixture(false, true);
    const run = find('ip-run-settings')!;
    const send = find('session-composer-send')!;
    const permission = find('agent-input-permission-chip')!;
    const mode = find('agent-input-session-mode-chip')!;
    expect(permission).not.toBeNull();
    expect(mode.textContent).toContain('Plan');
    const row = find('agent-input-desk-controls-row')!;
    expect(row).not.toBeNull();
    expect(row.contains(permission)).toBe(true);
    expect(row.contains(mode)).toBe(true);
    expect(row.querySelector('[aria-label="Source control"]')).not.toBeNull();
    expect(row.contains(send)).toBe(true);
    expect(row.contains(run)).toBe(false);
    expect(send.getAttribute('aria-disabled')).toBe('true');
});

it('scrolls a focused phone mode fully into its own viewport in either direction', async () => {
    storage.getState().applySettingsLocal({ agentInputActionBarLayout: 'scroll' });
    releaseFixture = applyDeskFixture();
    await renderFixture(false, true);
    await act(async () => { await new Promise(requestAnimationFrame); });
    const row = find('agent-input-desk-controls-row')!;
    const scroller = Array.from(row.querySelectorAll<HTMLElement>('div')).find((node) => getComputedStyle(node).overflowX === 'auto')!;
    const chip = find('agent-input-permission-chip')!;
    expect(scroller).toBeTruthy();
    scroller.getBoundingClientRect = () => ({ left: 0, right: 300, width: 300 } as DOMRect);
    chip.getBoundingClientRect = () => ({ left: 250, right: 360, width: 110 } as DOMRect);
    await act(async () => chip.focus());
    expect(scroller.scrollLeft).toBe(60);
    await act(async () => chip.blur());
    chip.getBoundingClientRect = () => ({ left: -90, right: 20, width: 110 } as DOMRect);
    await act(async () => chip.focus());
    expect(scroller.scrollLeft).toBe(-30);
});

it.each([821, 900])('reveals focused desk controls in the scrolling row at %ipx', async (width) => {
    vi.stubGlobal('innerWidth', width);
    storage.getState().applySettingsLocal({ agentInputActionBarLayout: 'scroll' });
    releaseFixture = applyDeskFixture();
    await renderFixture(false, false);
    await act(async () => { await new Promise(requestAnimationFrame); });
    const row = find('agent-input-desk-controls-row')!;
    const scroller = Array.from(row.querySelectorAll<HTMLElement>('div')).find(node => getComputedStyle(node).overflowX === 'auto')!;
    const chip = find('agent-input-permission-chip')!;
    expect(find('ip-run-settings')).not.toBeNull();
    expect(scroller).toBeTruthy();
    scroller.getBoundingClientRect = () => ({ left: 0, right: 300, width: 300 } as DOMRect);
    chip.getBoundingClientRect = () => ({ left: 250, right: 360, width: 110 } as DOMRect);
    await act(async () => chip.focus());
    expect(scroller.scrollLeft).toBe(60);
    await act(async () => chip.blur());
    chip.getBoundingClientRect = () => ({ left: -90, right: 20, width: 110 } as DOMRect);
    await act(async () => chip.focus());
    expect(scroller.scrollLeft).toBe(-30);
});

it('reveals partially visible phone shortcuts on real focus without moving the page', async () => {
    await act(async () => root.render(<CoordinatorPrompts coordinatorId="coordinator" phone />));
    const scroller = find('ip-phone-shortcuts')!;
    const chip = find('ip-start-new')!;
    // jsdom has no layout engine. Supply the observed browser geometry at the DOM boundary;
    // only the production focus handler may change scrollLeft.
    scroller.getBoundingClientRect = () => ({ left: 16, right: 374, width: 358 } as DOMRect);
    chip.getBoundingClientRect = () => ({ left: 198.40625, right: 401.8125, width: 203.40625 } as DOMRect);
    await act(async () => chip.focus());
    expect(document.activeElement).toBe(chip);
    expect(scroller.scrollLeft).toBe(27.8125);
    expect(chip.textContent).toContain(t('ignorePrevious.composer.startNew'));
    expect(find('ip-phone-shortcuts')).toBe(scroller);
    expect(document.documentElement.scrollLeft).toBe(0);
    expect(document.documentElement.scrollTop).toBe(0);

    await act(async () => chip.blur());
    chip.getBoundingClientRect = () => ({ left: 0, right: 203.40625, width: 203.40625 } as DOMRect);
    await act(async () => chip.focus());
    expect(scroller.scrollLeft).toBe(11.8125);

    await act(async () => chip.blur());
    chip.getBoundingClientRect = () => ({ left: 30, right: 233.40625, width: 203.40625 } as DOMRect);
    await act(async () => chip.focus());
    expect(scroller.scrollLeft).toBe(11.8125);
});

it('retains the run control across the phone breakpoint', async () => {
    await act(async () => root.render(<RealComposer phone />));
    const run = find('ip-run-settings');
    await act(async () => root.render(<RealComposer phone={false} />));
    expect(find('ip-run-settings')).toBe(run);
});

it('R45 removes status with the real composer, then re-observes empty and restored drafts in the same pane', async () => {
    const show = (visible: boolean, draft = '') => act(async () => root.render(<RealComposer visible={visible} draft={draft} />));
    await show(true, 'first\nsecond');
    expect(status()).toBe(t('ignorePrevious.composer.writing'));
    expect(position()).toBeDefined();
    await show(false);
    expect(find('session-unavailable')).not.toBeNull();
    expect(find('ip-composer-status-strip')).toBeNull();
    expect(find('ip-composer-position')).toBeNull();
    await show(true);
    expect(status()).toBe(t('ignorePrevious.composer.ready'));
    expect(find('ip-composer-position')).toBeNull();
    await show(false);
    await show(true, 'restored\ndraft');
    expect(status()).toBe(t('ignorePrevious.composer.writing'));
    expect(position()).toBe(t('ignorePrevious.composer.position', { line: 1, column: 1 }));
});

it('R45 appends status after real controls inside the actual composer box, leaving host slots and ordinary inputs intact', async () => {
    await act(async () => root.render(<RealComposer />));
    const box = find('agent-input-drop-zone')!;
    const strip = find('ip-composer-status-strip')!;
    expect(box.contains(strip)).toBe(true);
    expect(box.lastElementChild).toBe(strip);
    expect(box.contains(find('ip-run-settings'))).toBe(true);
    expect(find('agent-input-status-trailing')!.contains(find('fixture-context'))).toBe(true);
    await act(async () => root.render(<RealComposer desk={false} />));
    expect(find('ip-composer-status-strip')).toBeNull();
    expect(find('ip-composer-prompt')).toBeNull();
    expect(find('agent-input-action-footer')).not.toBeNull();
});

async function renderFixture(demoRoute = false, phone = false) {
    storage.getState().applySettingsLocal({ agentInputEnterToSend: true });
    await installAgentAssetLoader();
    const { CoordinatorBodyStub } = await import('../fixtures/CoordinatorBodyStub');
    await act(async () => root.render(<AppPaneProvider><DeskDemoContext.Provider value={demoRoute}><SafeAreaInsetsContext.Provider value={safeArea}><CoordinatorComposer coordinatorId="fx-coord" phone={phone}><CoordinatorBodyStub
        footerLeadingActions={<RunSettingsMenu />}
        statusTrailingActions={<span data-testid="fixture-context">Context</span>} />
    </CoordinatorComposer></SafeAreaInsetsContext.Provider></DeskDemoContext.Provider></AppPaneProvider>));
}

it.each([false, true])('R45 fixture state controls exclude demo identity with demo context %s and preserve playback permissions', async (demoRoute) => {
    releaseFixture = applyDeskFixture();
    await renderFixture();
    for (const state of ['idle', 'busy', 'readonly']) expect(find(`ip-fixture-composer-${state}`)).not.toBeNull();
    expect(find('agent-input-root')).not.toBeNull();
    await act(async () => {
        releaseFixture?.();
        releaseFixture = applyDeskFixture(Date.now(), 'demo');
    });
    await renderFixture(demoRoute);
    const session = storage.getState().sessions[demo.coordinatorId];
    const player = getDemoConversation()!;
    const playback = player.getSnapshot();
    expect(session.accessLevel).toBe('view');
    await act(async () => {
        for (const state of ['busy', 'readonly', 'idle']) find(`ip-fixture-composer-${state}`)?.click();
    });
    expect(storage.getState().sessions[demo.coordinatorId]).toBe(session);
    expect(player.getSnapshot()).toBe(playback);
    expect(find('ip-fixture-composer-states')).toBeNull();
    expect(find('ip-question-fixture')).toBeNull();
    expect(find('ip-fixture-tool-group')).toBeNull();
    for (const state of ['idle', 'busy', 'readonly']) expect(find(`ip-fixture-composer-${state}`)).toBeNull();
    expect(find('agent-input-root')).not.toBeNull();
    const input = container.querySelector<HTMLTextAreaElement>('[data-testid="session-composer-input"]')!;
    expect(input.readOnly || input.disabled).toBe(true);
});

it('R45 fixture idle Claude Plan uses production controls while synthetic send stays disabled', async () => {
    releaseFixture = applyDeskFixture();
    await renderFixture();
    expect(find('ip-fixture-composer-idle')).not.toBeNull();
    expect(find('ip-question-card')).not.toBeNull();
    expect(find('ip-fixture-tool-group')).not.toBeNull();
    expect(find('agent-input-session-mode-chip')?.textContent).toContain('Plan');
    expect(find('session-composer-send')?.getAttribute('aria-label')).toBe(t('common.send'));
    expect(find('agent-input-abort')).toBeNull();
    expect(container.querySelector(`[aria-label="${t('voiceAssistant.label')}"]`)).toBeNull();
    const input = container.querySelector<HTMLTextAreaElement>('[data-testid="session-composer-input"]')!;
    expect(input.placeholder).toBe(t('ignorePrevious.composer.placeholder'));
    expect(find('agent-input-root')).not.toBeNull();
    expect(find('agent-input-permission-chip')).not.toBeNull();
    expect(find('agent-input-action-footer')!.contains(find('ip-run-settings'))).toBe(true);
    expect(find('agent-input-status-trailing')!.contains(find('fixture-context'))).toBe(true);
    expect(find('ip-composer-prompt')).not.toBeNull();
    const submit = find('session-composer-send')!;
    expect(submit.getAttribute('aria-disabled')).toBe('true');
    await act(async () => {
        input.focus();
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, 'preview\ntext');
        input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
    });
    expect(status()).toBe(t('ignorePrevious.composer.writing'));
    expect(position()).toBe(t('ignorePrevious.composer.position', { line: 2, column: 5 }));
    expect(submit.getAttribute('aria-disabled')).toBe('true');
    await act(async () => {
        submit.click();
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(input.value).toBe('preview\ntext');
    expect(status()).toBe(t('ignorePrevious.composer.writing'));
    expect(find('agent-input-drop-zone')!.contains(find('ip-composer-status-strip'))).toBe(true);
});

it('R45 fixture busy Codex permission state keeps Stop local for click and shortcut, with send disabled', async () => {
    const release = applyDeskFixture();
    try {
        await renderFixture();
        expect(find('ip-fixture-composer-busy')).not.toBeNull();
        await act(async () => find('ip-fixture-composer-busy')!.click());
        const submit = find('session-composer-send')!;
        expect(submit.getAttribute('aria-label')).toBe(t('runs.stop.stopRunA11y'));
        expect(submit.getAttribute('aria-disabled')).not.toBe('true');
        expect(find('agent-input-permission-chip')?.textContent).toContain(t('agentInput.codexPermissionMode.safeYolo'));
        expect(storage.getState().sessions['fx-coord'].metadata?.flavor).toBe('codex');
        expect(find('agent-input-abort')).toBeNull();
        expect(container.querySelector(`[aria-label="${t('voiceAssistant.label')}"]`)).toBeNull();
        const input = container.querySelector<HTMLTextAreaElement>('[data-testid="session-composer-input"]')!;
        await act(async () => {
            input.focus();
            Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, 'offline draft');
            input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
        });
        const rpc = vi.spyOn(apiSocket, 'sessionRPC');
        const send = vi.spyOn(apiSocket, 'send');
        const request = vi.spyOn(apiSocket, 'request');
        try {
            await act(async () => submit.click());
            await act(async () => { await new Promise(resolve => setTimeout(resolve, 350)); });
            await act(async () => {
                input.focus();
                input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', shiftKey: true, bubbles: true }));
                input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', shiftKey: true, bubbles: true }));
                input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
            });
            await act(async () => { await new Promise(resolve => setTimeout(resolve, 350)); });
            expect(rpc).not.toHaveBeenCalled();
            expect(send).not.toHaveBeenCalled();
            expect(request).not.toHaveBeenCalled();
            expect(input.value).toBe('offline draft');
            expect(storage.getState().sessions['fx-coord'].thinking).toBe(true);
        } finally { rpc.mockRestore(); send.mockRestore(); request.mockRestore(); }
        await act(async () => find('ip-fixture-composer-idle')!.click());
        expect(submit.getAttribute('aria-label')).toBe(t('common.send'));
        expect(submit.getAttribute('aria-disabled')).toBe('true');
        expect(find('agent-input-session-mode-chip')?.textContent).toContain('Plan');
        expect(input.value).toBe('offline draft');
    } finally { await act(async () => release()); }
});

it('R45 fixture read-only signal suppresses busy Stop and typing', async () => {
    const release = applyDeskFixture();
    try {
        await renderFixture();
        expect(find('ip-fixture-composer-readonly')).not.toBeNull();
        await act(async () => find('ip-fixture-composer-readonly')!.click());
        const input = container.querySelector<HTMLTextAreaElement>('[data-testid="session-composer-input"]')!;
        expect(input.readOnly || input.disabled).toBe(true);
        expect(input.placeholder).toBe(t('session.sharing.viewOnlyMode'));
        expect(find('session-composer-send')?.getAttribute('aria-label')).toBe(t('common.send'));
        expect(find('session-composer-send')?.getAttribute('aria-disabled')).toBe('true');
        expect(storage.getState().sessions['fx-coord'].thinking).toBe(true);
    } finally { await act(async () => release()); }
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


it('R49 places phone shortcuts before the input and restores them when the real draft clears', async () => {
    await act(async () => root.render(<CoordinatorComposer coordinatorId="coordinator" phone><Input /></CoordinatorComposer>));
    const row = () => find('ip-phone-shortcuts');
    expect(row()).not.toBeNull();
    expect(row()!.querySelectorAll('button').length).toBeGreaterThanOrEqual(3);
    expect(row()!.compareDocumentPosition(handle.current!.getInputElement()!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await act(async () => handle.current!.setTextAndSelection(' ', { start: 1, end: 1 }));
    expect(row()).toBeNull();
    await act(async () => handle.current!.setTextAndSelection('', { start: 0, end: 0 }));
    expect(row()!.querySelectorAll('button').length).toBeGreaterThanOrEqual(3);
});

it('uses the chosen Terminal palette and bracketed labels for the shared phone shortcuts', async () => {
    deskPrefs.set('terminalPalette', 'gruvbox');
    await act(async () => root.render(<CoordinatorComposer coordinatorId="coordinator" phone><Input /></CoordinatorComposer>));
    const button = find('ip-brief-first')!;
    expect(button.textContent).toMatch(/^\[ .+ \]$/);
    expect(getComputedStyle(button).borderTopLeftRadius).toBe('0px');
    const sample = document.createElement('span'); sample.style.color = deskThemes.gruvbox.mute;
    expect(getComputedStyle(button.firstElementChild!).color).toBe(sample.style.color);
    await act(async () => button.focus());
    expect(getComputedStyle(button).borderTopWidth).toBe('2px');
    await act(async () => deskPrefs.set('chatStyle', 'mask'));
    expect(button.textContent).not.toMatch(/^\[ /);
    expect(getComputedStyle(button).borderTopLeftRadius).toBe('10px');
    deskPrefs.set('terminalPalette', 'tokyo');
});


it('R49 offline shortcut fills the fixture without sending and clearing restores the row', async () => {
    releaseFixture = applyDeskFixture();
    await renderFixture(false, true);
    await act(async () => find('ip-brief-first')!.click());
    const input = container.querySelector<HTMLTextAreaElement>('[data-testid="session-composer-input"]')!;
    expect(input.value).toBe(t('ignorePrevious.composer.briefPrompt'));
    expect(find('ip-phone-shortcuts')).toBeNull();
    expect(find('session-composer-send')?.getAttribute('aria-disabled')).toBe('true');
    await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, '');
        input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
    });
    expect(find('ip-phone-shortcuts')).not.toBeNull();
});


it('R49 phone rows follow their own pane and reset on a session replacement', async () => {
    const panes = (session: string) => <>
        <section data-pane="one"><CoordinatorComposer key={session} coordinatorId={session} phone><Input /></CoordinatorComposer></section>
        <section data-pane="two"><CoordinatorComposer coordinatorId="second" phone><Input inputRef={secondHandle} /></CoordinatorComposer></section>
    </>;
    await act(async () => root.render(panes('first')));
    await act(async () => handle.current!.setTextAndSelection('draft', { start: 5, end: 5 }));
    expect(container.querySelector('[data-pane="one"] [data-testid="ip-phone-shortcuts"]')).toBeNull();
    expect(container.querySelector('[data-pane="two"] [data-testid="ip-phone-shortcuts"]')).not.toBeNull();
    await act(async () => root.render(panes('replacement')));
    expect(container.querySelector('[data-pane="one"] [data-testid="ip-phone-shortcuts"]')).not.toBeNull();
});
