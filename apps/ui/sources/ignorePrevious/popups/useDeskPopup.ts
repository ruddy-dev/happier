import { useCallback, useEffect, useRef, type RefObject } from 'react';
import { Platform, type View } from 'react-native';

import { ESCAPE_LAYER_PRIORITIES, getMaxEscapeKeyBlockerPriority, isEditableEscapeTarget, useEscapeLayer } from '@/keyboard/escape';
import { restoreFocusToBestTarget, useFocusReturnFallbackRef } from '@/keyboard/focusReturn';
import { shouldCloseOnOutsideClick, type OutsideClickPolicy } from './outsideClickPolicy';

export type DeskPopupOptions = Partial<OutsideClickPolicy> & Readonly<{
    open: boolean;
    onClose: () => void;
    /** Attach to the host Pressable/View or DOM element, not an animated wrapper. */
    openerRef: RefObject<View | HTMLElement | null>;
    /** Additional pointer opener, excluded from outside clicks; focus still returns to openerRef. */
    pointerOpenerRef?: RefObject<View | HTMLElement | null>;
    /** Attach to the host containing the whole popup, including when portaled. */
    contentRef: RefObject<View | HTMLElement | null>;
    /** Return focus on explicit close or Escape, while preserving focus taken by an outside click. */
    returnFocusOnClose?: boolean;
    /** Follow a replacement opener only if the captured opener has been detached. */
    useLiveOpenerWhenDetached?: boolean;
}>;

// Pointer ordering only. Keyboard ordering stays with Happier's shared Escape stack.
const outsideClickLayers: { presentation: () => OutsideClickPolicy['presentation'] }[] = [];

/** The newest layer that closes on outside click; docked panels never do, so they are skipped. */
function topOutsideClickLayer() {
    for (let i = outsideClickLayers.length - 1; i >= 0; i -= 1) {
        if (outsideClickLayers[i].presentation() !== 'docked') return outsideClickLayers[i];
    }
    return undefined;
}

/**
 * Controlled dismissal for desk cards, bubbles and drawers. Call onClose directly
 * for explicit close buttons. Defaults to an overlay with no half-answered card.
 * Use FloatingOverlay for floating chrome; do not also install Popover's dismissal
 * on the same layer. Native callers retain their platform-specific dismissal UI.
 * L3: Nested layers mounted open together register child-under-parent.
 * L4: A text drag ending outside can close an overlay via the browser's click.
 * L6: A toggling opener explicitly closes even a half-answered overlay.
 * A docked drawer is a standing Escape layer, like RunSettingsMenu: Escape from
 * a non-editable target closes it and returns focus to Waiting (mockup 12).
 * An editable target outside the docked drawer keeps its own Escape behavior.
 * Desk popups inside a modal do not dismiss while that modal is visible.
 */
export function useDeskPopup(options: DeskPopupOptions): void {
    const current = useRef(options);
    current.current = options;
    // Closing can clear the caller's pinned state in the same render. Retain the open policy.
    const returnFocusOnClose = useRef(false);
    if (options.open) returnFocusOnClose.current = options.returnFocusOnClose === true;
    const close = useCallback(() => current.current.onClose(), []);
    const focusFallbackRef = useFocusReturnFallbackRef();
    const escapeFocusReturnRef = useRef<HTMLElement | null>(null);
    const webOpen = Platform.OS === 'web' && options.open;

    useEscapeLayer({
        enabled: webOpen,
        priority: ESCAPE_LAYER_PRIORITIES.popover,
        allowEditableTarget: true,
        focusReturnRef: escapeFocusReturnRef,
        onEscape: (event) => {
            if (getMaxEscapeKeyBlockerPriority() > ESCAPE_LAYER_PRIORITIES.popover) return false;
            const { presentation, contentRef } = current.current;
            const target = event instanceof KeyboardEvent ? event.target : null;
            if (presentation === 'docked' && target instanceof HTMLElement && isEditableEscapeTarget(target)
                && !(contentRef.current instanceof HTMLElement && contentRef.current.contains(target))) return false;
            const captured = escapeFocusReturnRef.current;
            const live = current.current.openerRef.current;
            if (current.current.useLiveOpenerWhenDetached && captured && !captured.isConnected && live instanceof HTMLElement) {
                escapeFocusReturnRef.current = live;
            }
            close();
        },
    });

    useEffect(() => {
        if (!webOpen || typeof document === 'undefined') return;
        const layer = { presentation: () => current.current.presentation ?? 'overlay' };
        outsideClickLayers.push(layer);
        const opener = current.current.openerRef.current;
        // Capture the actual opener so ref replacement cannot redirect focus to a new element.
        const focusReturnRef = { current: opener instanceof HTMLElement ? opener : null };
        escapeFocusReturnRef.current = focusReturnRef.current;
        let closedByOutsideClick = false;
        const onClick = (event: MouseEvent) => {
            if (topOutsideClickLayer() !== layer) return;
            // A modal or command palette above the desk owns its pointer interactions.
            if (getMaxEscapeKeyBlockerPriority() > ESCAPE_LAYER_PRIORITIES.popover) return;
            const { contentRef, openerRef, pointerOpenerRef, presentation = 'overlay', hasHalfAnsweredCard = false } = current.current;
            const target = event.target;
            if (!(target instanceof Node)) return;
            const targetElement = target instanceof Element ? target : target.parentElement;
            if (targetElement?.closest('[data-happy-popover-content]')) return;
            const content = contentRef.current;
            const trigger = openerRef.current;
            const pointerTrigger = pointerOpenerRef?.current;
            if (!(content instanceof HTMLElement) || content.contains(target)) return;
            if (trigger instanceof HTMLElement && trigger.contains(target)) return;
            if (pointerTrigger instanceof HTMLElement && pointerTrigger.contains(target)) return;
            if (!shouldCloseOnOutsideClick({ presentation, hasHalfAnsweredCard })) return;
            // Lower layers have already declined this event; let the target handle its click.
            closedByOutsideClick = true;
            close();
        };
        // Click runs after pointer focus, so cleanup can preserve the newly focused target.
        document.addEventListener('click', onClick, true);
        return () => {
            document.removeEventListener('click', onClick, true);
            outsideClickLayers.splice(outsideClickLayers.indexOf(layer), 1);
            const active = document.activeElement;
            const content = current.current.contentRef.current;
            if ((returnFocusOnClose.current && !closedByOutsideClick) || active == null || active === document.body || (content instanceof HTMLElement && content.contains(active))) {
                const live = current.current.openerRef.current;
                if (current.current.useLiveOpenerWhenDetached && focusReturnRef.current && !focusReturnRef.current.isConnected && live instanceof HTMLElement) {
                    focusReturnRef.current = live;
                }
                restoreFocusToBestTarget(focusReturnRef, focusFallbackRef);
            }
        };
    }, [webOpen, close, focusFallbackRef]);
}
