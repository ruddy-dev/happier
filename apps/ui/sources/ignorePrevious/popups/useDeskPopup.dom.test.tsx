/** @vitest-environment jsdom */
import React, { act, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createPortal } from 'react-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Platform } from 'react-native';
import { useEscapeLayer, ESCAPE_LAYER_PRIORITIES } from '@/keyboard/escape';
import { useDeskPopup } from './useDeskPopup';

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock();
});
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type PanelProps = { id: string; presentation?: 'docked' | 'overlay'; hasHalfAnsweredCard?: boolean; children?: React.ReactNode; forcedOpen?: boolean };
function Panel({ id, presentation = 'overlay', hasHalfAnsweredCard = false, children, forcedOpen }: PanelProps) {
    const [open, setOpen] = useState(false);
    const visible = forcedOpen ?? open;
    const openerRef = useRef<HTMLButtonElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const close = useDeskPopup({ open: visible, onClose: () => setOpen(false), openerRef, contentRef, presentation, hasHalfAnsweredCard });
    return <>
        <button ref={openerRef} data-testid={`${id}-opener`} onClick={() => setOpen(value => !value)}><span>{id}</span></button>
        {visible && createPortal(<div ref={contentRef} data-testid={id}>
            <input data-testid={`${id}-input`} />
            <button data-testid={`${id}-close`} onClick={close}>close</button>
            {children}
        </div>, document.body)}
    </>;
}
function UpstreamModal({ onClose }: { onClose: () => void }) {
    useEscapeLayer({ priority: ESCAPE_LAYER_PRIORITIES.modal, allowEditableTarget: true, onEscape: onClose });
    return null;
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
    await act(async () => { root.render(children); });
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

    it('respects the existing upstream modal Escape priority', async () => {
        const modalClose = vi.fn();
        await render(<><Panel id="panel" /><UpstreamModal onClose={modalClose} /></>);
        await click(element('panel-opener'));
        await escape();
        expect(modalClose).toHaveBeenCalledOnce();
        expect(element('panel')).toBeTruthy();
    });

    it('does not swallow clicks in an upstream modal above the popup', async () => {
        const modalClick = vi.fn();
        await render(<><Panel id="panel" /><UpstreamModal onClose={() => {}} /><button data-testid="modal-action" onClick={modalClick} /></>);
        await click(element('panel-opener'));
        await click(element('modal-action'));
        expect(modalClick).toHaveBeenCalledOnce();
        expect(element('panel')).toBeTruthy();
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
