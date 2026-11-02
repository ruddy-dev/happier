export const DESK_FONT_STACK = '"JetBrains Mono", ui-monospace, monospace';
// Exact pathnames only. Later pass-through pages opt in here and mount DeskFontRoot.
export const DESK_FONT_ROUTES: readonly string[] = ['/desk', '/desk/settings'];

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
