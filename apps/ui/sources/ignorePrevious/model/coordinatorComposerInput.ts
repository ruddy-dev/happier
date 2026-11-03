import * as React from 'react';

type DraftStatus = Readonly<{ writing: boolean; multiline: boolean; line: number; column: number }>;

/** Presentation only: the textarea remains the draft/selection authority. No text is retained here. */
export function createCoordinatorComposerObserver() {
    let status: DraftStatus = { writing: false, multiline: false, line: 1, column: 1 };
    const listeners = new Set<() => void>();
    return {
        getSnapshot: () => status,
        subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
        observe: (input: HTMLTextAreaElement) => {
            const text = input.value;
            const caret = input.selectionDirection === 'backward' ? input.selectionStart : input.selectionEnd;
            const multiline = text.includes('\n');
            let line = 1;
            if (multiline) {
                for (let i = text.indexOf('\n'); i >= 0 && i < caret; i = text.indexOf('\n', i + 1)) line++;
            }
            const column = multiline && caret > 0 ? caret - text.lastIndexOf('\n', caret - 1) : 1;
            const writing = text.length > 0;
            if (status.writing === writing && status.multiline === multiline && status.line === line && status.column === column) return;
            status = { writing, multiline, line, column };
            for (const listener of listeners) listener();
        },
    };
}

export const CoordinatorComposerInputContext = React.createContext<Readonly<{
    observer: ReturnType<typeof createCoordinatorComposerObserver>;
    prompt: React.ReactNode;
    textStyle?: Readonly<{ fontFamily: string; color: string }>;
}> | null>(null);

/** AgentInput's session input is the only consumer, even when other textareas share the pane. */
export function useCoordinatorComposerInput(testID: string | undefined) {
    const context = React.useContext(CoordinatorComposerInputContext);
    return testID === 'session-composer-input' ? context : null;
}
