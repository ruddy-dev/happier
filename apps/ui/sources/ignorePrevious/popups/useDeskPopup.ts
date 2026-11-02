import { useCallback, useEffect, useRef, type RefObject } from 'react';
import { Platform, type View } from 'react-native';

import { ESCAPE_LAYER_PRIORITIES, getMaxEscapeKeyBlockerPriority, useEscapeLayer } from '@/keyboard/escape';
import { restoreFocusToBestTarget } from '@/keyboard/focusReturn';
import { shouldCloseOnOutsideClick, type OutsideClickPolicy } from './outsideClickPolicy';

export type DeskPopupOptions = Partial<OutsideClickPolicy> & Readonly<{
    open: boolean;
    onClose: () => void;
    /** Attach to the host Pressable/View or DOM element, not an animated wrapper. */
    openerRef: RefObject<View | HTMLElement | null>;
    /** Attach to the host containing the whole popup, including when portaled. */
    contentRef: RefObject<View | HTMLElement | null>;
}>;

// Pointer ordering only. Keyboard ordering stays with Happier's shared Escape stack.
const outsideClickLayers: object[] = [];

/**
 * Controlled dismissal for desk cards, bubbles and drawers. Returns an explicit close
 * handler for a close button. Defaults to an overlay with no half-answered card.
 * Use FloatingOverlay for floating chrome; do not also install Popover's dismissal
 * on the same layer. Native callers retain their platform-specific dismissal UI.
 */
export function useDeskPopup(options: DeskPopupOptions): () => void {
    const current = useRef(options);
    current.current = options;
    const close = useCallback(() => current.current.onClose(), []);
    const webOpen = Platform.OS === 'web' && options.open;

    useEscapeLayer({
        enabled: webOpen,
        priority: ESCAPE_LAYER_PRIORITIES.popover,
        allowEditableTarget: true,
        onEscape: close,
    });

    useEffect(() => {
        if (!webOpen || typeof document === 'undefined') return;
        const layer = {};
        outsideClickLayers.push(layer);
        const opener = current.current.openerRef.current;
        // Capture the actual opener so ref replacement cannot redirect focus to a new element.
        const focusReturnRef = { current: opener instanceof HTMLElement ? opener : null };
        const onClick = (event: MouseEvent) => {
            if (outsideClickLayers.at(-1) !== layer) return;
            // A modal or command palette above the desk owns its pointer interactions.
            if (getMaxEscapeKeyBlockerPriority() > ESCAPE_LAYER_PRIORITIES.popover) return;
            const { contentRef, openerRef, presentation = 'overlay', hasHalfAnsweredCard = false } = current.current;
            const target = event.target;
            if (!(target instanceof Node)) return;
            const content = contentRef.current;
            const trigger = openerRef.current;
            if (content instanceof HTMLElement && content.contains(target)) return;
            if (trigger instanceof HTMLElement && trigger.contains(target)) return;
            if (!shouldCloseOnOutsideClick({ presentation, hasHalfAnsweredCard })) return;
            // Keep this click from dismissing a lower layer or reaching its click handlers.
            event.stopPropagation();
            event.stopImmediatePropagation();
            close();
        };
        // Click runs after the browser's pointer focus action, so focus restoration sticks.
        document.addEventListener('click', onClick, true);
        return () => {
            document.removeEventListener('click', onClick, true);
            outsideClickLayers.splice(outsideClickLayers.indexOf(layer), 1);
            restoreFocusToBestTarget(focusReturnRef);
        };
    }, [webOpen, close]);

    return close;
}
