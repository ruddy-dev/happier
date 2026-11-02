/** @vitest-environment jsdom */
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi, type MockInstance } from 'vitest';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { FreshStartMenu } from './FreshStartMenu';
import { useDeskPopup } from '../popups/useDeskPopup';

// Real web hosts are needed to test portaled focus and pointer propagation.
vi.mock('react-native', async () => vi.importActual('react-native-web'));
vi.mock('@/hooks/ui/useReducedMotionPreference', async () => {
    const { createReducedMotionModuleMock } = await import('@/dev/testkit/mocks/reducedMotion');
    return createReducedMotionModuleMock(true);
});
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
const compact = vi.fn();
const newConversation = vi.fn();
const brief = vi.fn();
const closeCard = vi.fn();
const otherControl = vi.fn();
let confirm: MockInstance<typeof window.confirm>;
function Card() {
    const openerRef = React.useRef<HTMLButtonElement>(null);
    const contentRef = React.useRef<HTMLDivElement>(null);
    useDeskPopup({ open: true, onClose: closeCard, openerRef, contentRef });
    return <><button ref={openerRef}>Card</button><div ref={contentRef}><button data-testid="other-control" onClick={otherControl}>Other</button>
        <FreshStartMenu onCompact={compact} onNewConversation={newConversation} onBriefMe={brief} stop={<button data-testid="fixture-stop">Stop</button>} />
    </div></>;
}
beforeEach(() => {
    vi.clearAllMocks();
    confirm = vi.spyOn(window, 'confirm');
    container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
    expect(confirm).not.toHaveBeenCalled();
    expect(document.querySelector('[aria-modal="true"]')).toBeNull();
    await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks();
});
async function render(width = 1200) {
    vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(width);
    await act(async () => window.dispatchEvent(new Event('resize')));
    await act(async () => root.render(<SafeAreaInsetsContext.Provider value={{ top: 0, right: 0, bottom: 0, left: 0 }}><Card /></SafeAreaInsetsContext.Provider>));
}
function element(id: string) {
    const found = document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
    expect(found, id).not.toBeNull(); return found!;
}
async function click(id: string) { await act(async () => { element(id).focus(); element(id).click(); }); }
it('Finding 2: Escape returns to menu, then closes and focuses opener without dispatching', async () => {
    await render(); await click('ip-fresh-start'); await click('ip-fresh-new');
    expect(element('ip-fresh-confirm').textContent).toContain('Start a new conversation?');
    expect(document.activeElement).toBe(element('ip-fresh-cancel'));
    await click('ip-fresh-cancel');
    expect(newConversation).not.toHaveBeenCalled(); expect(compact).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(element('ip-fresh-new'));
    await click('ip-fresh-new');
    await act(async () => document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(newConversation).not.toHaveBeenCalled(); expect(compact).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(element('ip-fresh-new'));
    await act(async () => document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(document.querySelector('[data-testid="ip-fresh-menu"]')).toBeNull();
    expect(document.activeElement).toBe(element('ip-fresh-start'));
    expect(newConversation).not.toHaveBeenCalled(); expect(compact).not.toHaveBeenCalled();
    await click('ip-fresh-start'); await click('ip-fresh-new'); await click('ip-fresh-confirm-new');
    expect(document.activeElement).toBe(element('ip-fresh-start')); 
    expect(newConversation).toHaveBeenCalledTimes(1); expect(compact).not.toHaveBeenCalled();
});
it('Finding 4 and 7: outside card control receives click; Compact restores opener focus', async () => {
    await render(); await click('ip-fresh-start');
    // JSDOM does not hit-test pointer coordinates. A full-viewport fixed layer
    // would intercept the click in a browser, even if direct .click() reaches it here.
    const blockingBackdrop = [...document.querySelectorAll<HTMLElement>('*')].find(node => {
        const style = node.style;
        return style.position === 'fixed' && style.top === '0px' && style.right === '0px'
            && style.bottom === '0px' && style.left === '0px' && style.pointerEvents !== 'none';
    });
    expect(blockingBackdrop).toBeUndefined();
    await click('other-control');
    expect(otherControl).toHaveBeenCalledTimes(1); expect(closeCard).not.toHaveBeenCalled();
    await click('ip-fresh-start'); await click('ip-fresh-compact');
    expect(document.activeElement).toBe(element('ip-fresh-start'));
    expect(compact).toHaveBeenCalledTimes(1); expect(newConversation).not.toHaveBeenCalled();
    expect(closeCard).not.toHaveBeenCalled();
});
it.each([390, 767])('Finding 6: phone fold at %i puts all three actions in one menu and leaves Stop outside', async width => {
    await render(width);
    expect(document.querySelector('[data-testid="ip-fresh-start"]')).toBeNull();
    expect(document.querySelector('[data-testid="ip-fresh-brief"]')).toBeNull();
    await click('ip-fresh-more');
    const menu = element('ip-fresh-menu');
    for (const id of ['ip-fresh-brief', 'ip-fresh-compact', 'ip-fresh-new']) expect(menu.contains(element(id))).toBe(true);
    expect(menu.contains(element('fixture-stop'))).toBe(false);
    await click('ip-fresh-brief'); expect(brief).toHaveBeenCalledTimes(1);
    await click('ip-fresh-more'); await click('ip-fresh-new');
    expect(document.activeElement).toBe(element('ip-fresh-cancel'));
    await click('ip-fresh-confirm-new'); expect(newConversation).toHaveBeenCalledTimes(1);
});

it('Finding 6: 768 uses the desk opener', async () => {
    await render(768);
    expect(element('ip-fresh-start')).toBeTruthy();
    expect(document.querySelector('[data-testid="ip-fresh-more"]')).toBeNull();
});
