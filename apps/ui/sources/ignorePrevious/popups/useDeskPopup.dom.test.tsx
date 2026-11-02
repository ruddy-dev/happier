/** @vitest-environment jsdom */
import React, { act, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createPortal } from 'react-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Platform } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { BaseModal } from '@/modal/components/BaseModal';
import { Popover } from '@/components/ui/popover/Popover';
import { FocusReturnProvider, useFocusReturnFallbackRef } from '@/keyboard/focusReturn';
import { useDeskPopup } from './useDeskPopup';

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    // Real DOM hosts are needed for Radix focus and Popover containment.
    const web = await import('react-native-web');
    return createReactNativeWebMock({ View: web.View, Animated: { View: web.View }, KeyboardAvoidingView: web.View });
});
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type PanelProps = { id: string; presentation?: 'docked' | 'overlay'; hasHalfAnsweredCard?: boolean; children?: React.ReactNode; forcedOpen?: boolean; hideOpener?: boolean; returnFocusOnClose?: boolean };
function Panel({ id, presentation = 'overlay', hasHalfAnsweredCard = false, children, forcedOpen, hideOpener, returnFocusOnClose }: PanelProps) {
    const [open, setOpen] = useState(false);
    const visible = forcedOpen ?? open;
    const openerRef = useRef<HTMLButtonElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const close = () => setOpen(false);
    useDeskPopup({ open: visible, onClose: () => setOpen(false), openerRef, contentRef, presentation, hasHalfAnsweredCard, returnFocusOnClose });
    return <>
        {!hideOpener && <button ref={openerRef} data-testid={`${id}-opener`} onClick={() => setOpen(value => !value)}><span>{id}</span></button>}
        {visible && createPortal(<div ref={contentRef} data-testid={id}>
            <input data-testid={`${id}-input`} />
            <button data-testid={`${id}-close`} onClick={close}>close</button>
            {children}
        </div>, document.body)}
    </>;
}
function UpstreamModal({ onClose, onClick }: { onClose: () => void; onClick?: () => void }) {
    return <BaseModal visible onClose={onClose}>
        <input data-testid="modal-input" />
        <button data-testid="modal-action" onClick={onClick}>action</button>
    </BaseModal>;
}
function Menu({ onSelect }: { onSelect: () => void }) {
    const anchorRef = useRef<HTMLButtonElement>(null);
    return <>
        <button ref={anchorRef}>menu</button>
        <Popover open anchorRef={anchorRef} backdrop={false} portal={{ web: true }} onRequestClose={() => {}}>
            {() => <button data-testid="menu-item" onClick={onSelect}>item</button>}
        </Popover>
    </>;
}
function Fallback() {
    const ref = useFocusReturnFallbackRef<HTMLInputElement | null>();
    return <input ref={ref} data-testid="fallback" />;
}

let root: Root;
let container: HTMLDivElement;
function element(id: string): HTMLElement {
    const result = document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
    if (!result) throw new Error(`Missing test element: ${id}`);
    return result;
}
async function click(target: HTMLElement) {
    // Model the browser sequence, including focus between pointerdown and click.
    await act(async () => {
        target.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
        target.focus();
        target.click();
    });
}
async function escape() {
    await act(async () => { document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
}
async function render(children: React.ReactNode) {
    await act(async () => { root.render(<SafeAreaInsetsContext.Provider value={{ top: 0, right: 0, bottom: 0, left: 0 }}>{children}</SafeAreaInsetsContext.Provider>); });
}

beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
});
afterEach(async () => {
    await act(async () => { root.unmount(); });
    container.remove();
    Platform.OS = 'web';
    vi.restoreAllMocks();
});

describe('desk popup interaction', () => {
    it('closes portaled layers top-down with Escape from an input and restores each opener', async () => {
        await render(<Panel id="parent"><Panel id="child" /></Panel>);
        await click(element('parent-opener'));
        await click(element('child-opener'));
        element('child-input').focus();
        await escape();
        expect(document.querySelector('[data-testid="child"]')).toBeNull();
        expect(element('parent')).toBeTruthy();
        expect(document.activeElement).toBe(element('child-opener'));
        await escape();
        expect(document.querySelector('[data-testid="parent"]')).toBeNull();
        expect(document.activeElement).toBe(element('parent-opener'));
    });

    it('outside click closes only the top layer, returning focus, and inside clicks keep it open', async () => {
        await render(<Panel id="parent"><Panel id="child" /></Panel>);
        await click(element('parent-opener'));
        await click(element('child-opener'));
        await click(element('child-input'));
        expect(element('child')).toBeTruthy();
        await click(container);
        expect(document.querySelector('[data-testid="child"]')).toBeNull();
        expect(element('parent')).toBeTruthy();
        expect(document.activeElement).toBe(element('child-opener'));
        await click(container);
        expect(document.querySelector('[data-testid="parent"]')).toBeNull();
        expect(document.activeElement).toBe(element('parent-opener'));
    });

    it('an opener descendant toggles closed once instead of closing then reopening', async () => {
        await render(<Panel id="panel" />);
        await click(element('panel-opener'));
        await click(element('panel-opener').querySelector('span')!);
        expect(document.querySelector('[data-testid="panel"]')).toBeNull();
        expect(document.activeElement).toBe(element('panel-opener'));
    });

    it('returns focus after explicit close and ignores a removed opener', async () => {
        await render(<Panel id="panel" />);
        await click(element('panel-opener'));
        await click(element('panel-close'));
        expect(document.activeElement).toBe(element('panel-opener'));
        await click(element('panel-opener'));
        element('panel-input').focus();
        await render(<Panel id="panel" key="replacement" />);
        expect(document.activeElement).not.toBe(element('panel-opener')); // old opener was removed
        await click(element('panel-opener'));
        await escape();
        expect(document.querySelector('[data-testid="panel"]')).toBeNull();
    });

    it.each(['docked', 'overlay'] as const)('Q13 %s honors current half-answer state without blocking Escape', async (presentation) => {
        await render(<Panel id="panel" presentation={presentation} hasHalfAnsweredCard />);
        await click(element('panel-opener'));
        await click(container);
        expect(element('panel')).toBeTruthy();
        await render(<Panel id="panel" presentation={presentation} hasHalfAnsweredCard={false} />);
        await click(container);
        if (presentation === 'docked') {
            expect(element('panel')).toBeTruthy();
            await escape();
        }
        expect(document.querySelector('[data-testid="panel"]')).toBeNull();
    });

    it('returns focus when the caller closes a still-mounted popup', async () => {
        await render(<Panel id="panel" forcedOpen />);
        element('panel-input').focus();
        await render(<Panel id="panel" forcedOpen={false} />);
        expect(document.activeElement).toBe(element('panel-opener'));
    });

    it('rerendering a lower layer does not promote it, and Escape can discard a half-answer', async () => {
        await render(<Panel id="parent"><Panel id="child" hasHalfAnsweredCard /></Panel>);
        await click(element('parent-opener'));
        await click(element('child-opener'));
        await render(<Panel id="parent" presentation="docked"><Panel id="child" hasHalfAnsweredCard /></Panel>);
        await click(container);
        expect(element('child')).toBeTruthy();
        await escape();
        expect(document.querySelector('[data-testid="child"]')).toBeNull();
        expect(element('parent')).toBeTruthy();
    });

    it.each(['overlay', 'docked'] as const)('B1 yields Escape to a real upstream modal above a %s', async (presentation) => {
        const modalClose = vi.fn();
        await render(<><Panel id="panel" presentation={presentation} /></>);
        await click(element('panel-opener'));
        await render(<><Panel id="panel" presentation={presentation} /><UpstreamModal onClose={modalClose} /></>);
        element('modal-input').focus();
        await escape();
        expect(modalClose).toHaveBeenCalledOnce();
        expect(element('panel')).toBeTruthy();
    });

    it('B1 lets a real modal handle clicks and releases the blocker on unmount', async () => {
        const modalClick = vi.fn();
        await render(<Panel id="panel" />);
        await click(element('panel-opener'));
        await render(<><Panel id="panel" /><UpstreamModal onClose={() => {}} onClick={modalClick} /></>);
        await click(element('modal-action'));
        expect(modalClick).toHaveBeenCalledOnce();
        expect(element('panel')).toBeTruthy();
        await render(<><Panel id="panel" /></>);
        element('panel-input').focus();
        await escape();
        expect(document.querySelector('[data-testid="panel"]')).toBeNull();
    });

    it('B2 lets a real portaled Popover menu item run without closing the card', async () => {
        const select = vi.fn();
        await render(<Panel id="panel"><Menu onSelect={select} /></Panel>);
        await click(element('panel-opener'));
        expect(element('panel').contains(element('menu-item'))).toBe(false);
        await click(element('menu-item'));
        expect(select).toHaveBeenCalledOnce();
        expect(element('panel')).toBeTruthy();
    });

    it('B3 keeps focus in a sibling when a lower layer closes programmatically', async () => {
        await render(<><Panel id="a" forcedOpen /><Panel id="b" forcedOpen /></>);
        element('b-input').focus();
        await render(<><Panel id="a" forcedOpen={false} /><Panel id="b" forcedOpen /></>);
        expect(document.activeElement).toBe(element('b-input'));
    });

    it('B3 keeps focus in the composer after its click dismisses an overlay', async () => {
        await render(<><Panel id="panel" /><input data-testid="composer" /></>);
        await click(element('panel-opener'));
        await click(element('composer'));
        expect(document.querySelector('[data-testid="panel"]')).toBeNull();
        expect(document.activeElement).toBe(element('composer'));
    });

    it.each(['input', 'textarea', 'button', 'a'] as const)('Finding 2 pinned popups preserve outside %s focus', async (tag) => {
        await render(<><Panel id="panel" returnFocusOnClose />{React.createElement(tag, { 'data-testid': 'composer', ...(tag === 'a' ? { href: '#destination', onClick: (event: React.MouseEvent) => event.preventDefault() } : {}) })}</>);
        await click(element('panel-opener'));
        await click(element('composer'));
        expect(document.querySelector('[data-testid="panel"]')).toBeNull();
        expect(document.activeElement).toBe(element('composer'));
    });

    it('Finding 2 C9 uses the last open focus policy when the closing render clears pinned state', async () => {
        await render(<><Panel id="panel" forcedOpen returnFocusOnClose /><input data-testid="composer" /></>);
        element('composer').focus();
        await render(<><Panel id="panel" forcedOpen={false} returnFocusOnClose={false} /><input data-testid="composer" /></>);
        expect(document.activeElement).toBe(element('panel-opener'));
    });

    it('M1 opens the second popup with one click', async () => {
        await render(<><Panel id="a" /><Panel id="b" /></>);
        await click(element('a-opener'));
        await click(element('b-opener'));
        expect(document.querySelector('[data-testid="a"]')).toBeNull();
        expect(element('b')).toBeTruthy();
    });

    it('M1 lets a parent action run when dismissing its child', async () => {
        const action = vi.fn();
        await render(<Panel id="parent"><button data-testid="action" onClick={action}>action</button><Panel id="child" /></Panel>);
        await click(element('parent-opener'));
        await click(element('child-opener'));
        await click(element('action'));
        expect(action).toHaveBeenCalledOnce();
        expect(document.querySelector('[data-testid="child"]')).toBeNull();
        expect(element('parent')).toBeTruthy();
    });

    it('M1 lets an outside link handler prevent its default navigation', async () => {
        const action = vi.fn((event: React.MouseEvent) => event.preventDefault());
        await render(<><Panel id="panel" /><a href="#destination" data-testid="link" onClick={action}>link</a></>);
        await click(element('panel-opener'));
        await click(element('link'));
        expect(action).toHaveBeenCalledOnce();
        expect(action.mock.calls[0][0].defaultPrevented).toBe(true);
        expect(document.querySelector('[data-testid="panel"]')).toBeNull();
    });

    it('M2 skips a later docked panel when dismissing the top overlay', async () => {
        await render(<Panel id="overlay" />);
        await click(element('overlay-opener'));
        await render(<><Panel id="overlay" /><Panel id="dock" forcedOpen presentation="docked" /></>);
        await click(container);
        expect(document.querySelector('[data-testid="overlay"]')).toBeNull();
        expect(element('dock')).toBeTruthy();
    });

    it('M3 lets composer Escape run while a docked drawer stays open', async () => {
        const composerEscape = vi.fn();
        await render(<><Panel id="dock" presentation="docked" /><input data-testid="composer" onKeyDown={composerEscape} /></>);
        await click(element('dock-opener'));
        await click(element('composer'));
        await escape();
        expect(composerEscape).toHaveBeenCalledOnce();
        expect(element('dock')).toBeTruthy();
        expect(document.activeElement).toBe(element('composer'));
        element('dock-input').focus();
        await escape();
        expect(document.querySelector('[data-testid="dock"]')).toBeNull();
    });

    it('L1 fails open when the content ref cannot resolve to a host', async () => {
        const close = vi.fn();
        function Unresolved() {
            const ref = useRef<HTMLDivElement>(null);
            useDeskPopup({ open: true, onClose: close, contentRef: ref, openerRef: ref });
            return <button data-testid="unresolved">inside</button>;
        }
        await render(<Unresolved />);
        await click(element('unresolved'));
        expect(close).not.toHaveBeenCalled();
    });

    it('L2 uses the context fallback when the captured opener was removed', async () => {
        await render(<FocusReturnProvider><Fallback /><Panel id="panel" /></FocusReturnProvider>);
        await click(element('panel-opener'));
        await render(<FocusReturnProvider><Fallback /><Panel id="panel" hideOpener /></FocusReturnProvider>);
        element('panel-input').focus();
        await escape();
        expect(document.activeElement).toBe(element('fallback'));

    });

    it('T2 returns to the captured opener after its ref moves to another mounted element', async () => {
        function Moving({ moved, open }: { moved: boolean; open: boolean }) {
            const openerRef = useRef<HTMLButtonElement>(null);
            const contentRef = useRef<HTMLDivElement>(null);
            useDeskPopup({ open, onClose: () => {}, openerRef, contentRef });
            return <>
                <button ref={moved ? undefined : openerRef} data-testid="original">original</button>
                <button ref={moved ? openerRef : undefined} data-testid="replacement">replacement</button>
                {open && <div ref={contentRef}><input data-testid="moving-input" /></div>}
            </>;
        }
        await render(<Moving moved={false} open />);
        await render(<Moving moved open />);
        element('moving-input').focus();
        await render(<Moving moved open={false} />);
        expect(document.activeElement).toBe(element('original'));
    });

    it.each(['escape', 'click'] as const)('L3 documents parent-first dismissal when nested layers mount open together: %s', async (action) => {
        const closed: string[] = [];
        function InitiallyOpen({ id, children }: { id: string; children?: React.ReactNode }) {
            const contentRef = useRef<HTMLDivElement>(null);
            const openerRef = useRef<HTMLButtonElement>(null);
            useDeskPopup({ open: true, onClose: () => closed.push(id), contentRef, openerRef });
            return <div ref={contentRef}>{children}</div>;
        }
        await render(<InitiallyOpen id="parent"><InitiallyOpen id="child" /></InitiallyOpen>);
        if (action === 'escape') await escape();
        else await click(container);
        expect(closed).toEqual(['parent']);
    });

    it('does not attach web dismissal on native', async () => {
        Platform.OS = 'ios';
        await render(<Panel id="panel" />);
        await click(element('panel-opener'));
        await click(container);
        await escape();
        expect(element('panel')).toBeTruthy();
        await click(element('panel-close'));
        expect(document.querySelector('[data-testid="panel"]')).toBeNull();
    });
});
