import * as React from 'react';

/**
 * Lets code outside SessionView put text into, read, or focus a session's composer.
 * Unlike sessionResumeRequests, requests return false instead of throwing when no
 * composer is mounted: callers such as the desk fire these opportunistically.
 */
export type ComposerRequestHandle = Readonly<{
    setText(text: string): void;
    getText(): string;
    focus(): void;
}>;

const handlesBySessionId = new Map<string, ComposerRequestHandle[]>();

function currentHandle(sessionId: string): ComposerRequestHandle | null {
    const handles = handlesBySessionId.get(sessionId);
    return handles && handles.length > 0 ? handles[handles.length - 1] : null;
}

/** The most recent registration wins; unregistering restores the one before it. */
export function registerComposerRequestHandle(sessionId: string, handle: ComposerRequestHandle): () => void {
    const handles = handlesBySessionId.get(sessionId) ?? [];
    handles.push(handle);
    handlesBySessionId.set(sessionId, handles);
    return () => {
        const index = handles.lastIndexOf(handle);
        if (index >= 0) handles.splice(index, 1);
        if (handles.length === 0 && handlesBySessionId.get(sessionId) === handles) {
            handlesBySessionId.delete(sessionId);
        }
    };
}

/** Registers once per sessionId and always forwards to the latest handle passed in. */
export function useComposerRequestHandle(sessionId: string, handle: ComposerRequestHandle): void {
    const latest = React.useRef(handle);
    latest.current = handle;

    React.useEffect(() => {
        const proxy: ComposerRequestHandle = {
            setText: (text) => latest.current.setText(text),
            getText: () => latest.current.getText(),
            focus: () => latest.current.focus(),
        };
        return registerComposerRequestHandle(sessionId, proxy);
    }, [sessionId]);
}

export function requestComposerText(sessionId: string, text: string, options?: Readonly<{ focus?: boolean }>): boolean {
    const handle = currentHandle(sessionId);
    if (!handle) return false;
    handle.setText(text);
    if (options?.focus) handle.focus();
    return true;
}

export function requestComposerFocus(sessionId: string): boolean {
    const handle = currentHandle(sessionId);
    if (!handle) return false;
    handle.focus();
    return true;
}

/** The composer's current text, or null when no composer is mounted for the session. */
export function readComposerText(sessionId: string): string | null {
    return currentHandle(sessionId)?.getText() ?? null;
}
