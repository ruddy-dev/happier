export const DESK_FONT_STACK = '"JetBrains Mono", ui-monospace, monospace';
// Exact pathnames only; the root entry opts in only while signed out.
export const DESK_HAPPIER_PAGE_ROUTES: readonly string[] = ['/', '/restore/manual', '/settings/voice'];
export const DESK_FONT_ROUTES: readonly string[] = ['/desk', '/desk/settings', ...DESK_HAPPIER_PAGE_ROUTES];

const installations = new WeakMap<Document, { style: HTMLStyleElement; mounts: number }>();

/** Reuse the written rules, but keep them out of the document when no listed route is mounted. */
export function mountDeskFont(doc: Document): () => void {
    let installation = installations.get(doc);
    if (!installation) {
        const style = doc.createElement('style');
        style.id = 'ip-desk-font';
        style.textContent = `
@font-face {
    font-family: "JetBrains Mono";
    src: url("/ignore-previous/fonts/jetbrains-mono-latin.woff2") format("woff2");
    font-style: normal;
    font-weight: 500 700;
    font-display: swap;
}
[data-ip-font="desk"] { font-family: ${DESK_FONT_STACK}; }
[data-ip-page-scope] :focus-visible { outline: 3px solid var(--ip-page-focus) !important; outline-offset: 2px; }
/* The mobile welcome copy crosses the inherited planet; opaque theme canvas keeps it readable. */
@media (max-width: 720px) {
    [data-ip-page-scope] [data-testid="welcome-decision-panel"] [data-testid="welcome-question-title"],
    [data-ip-page-scope] [data-testid="welcome-decision-panel"] [data-testid="welcome-question-subtitle"],
    [data-ip-page-scope] [data-testid="welcome-decision-panel"] [data-testid="welcome-private-key-copy"],
    [data-ip-page-scope] [data-testid="welcome-decision-panel"] [data-testid="welcome-signup-disabled"],
    [data-ip-page-scope] [data-testid="welcome-decision-panel"] [data-testid="welcome-server-loading"] {
        background-color: var(--ip-page-surface); box-shadow: 0 0 8px 4px var(--ip-page-surface);
    }
}
[data-ip-terminal] [data-testid="welcome-decision-panel"] [data-testid="welcome-primary-start"],
[data-ip-terminal] [data-testid="welcome-decision-panel"] [data-testid="welcome-secondary-login"],
[data-ip-terminal] [data-testid="welcome-decision-panel"] [data-testid="welcome-create-account"],
[data-ip-terminal] [data-testid="welcome-decision-panel"] [data-testid="welcome-signup-provider"],
[data-ip-terminal] [data-testid="welcome-decision-panel"] [data-testid="welcome-login-provider"],
[data-ip-terminal] [data-testid="welcome-decision-panel"] [data-testid="welcome-mtls-login"],
[data-ip-terminal] [data-testid="welcome-decision-panel"] [data-testid="welcome-change-relay"],
[data-ip-terminal] [data-testid="welcome-decision-panel"] [data-testid="welcome-retry-server"],
[data-ip-terminal] [data-testid="restore-manual-secret-input"],
[data-ip-terminal] [data-testid="restore-manual-submit"],
[data-ip-terminal] [data-testid="ip-voice-page"] :is(button, input, select, textarea, [role="button"]) {
    border-radius: 2px !important;
}
`;
        installation = { style, mounts: 0 };
        installations.set(doc, installation);
    }
    const active = installation;
    if (active.mounts++ === 0) doc.head.appendChild(active.style);
    return () => {
        if (--active.mounts === 0) active.style.remove();
    };
}
