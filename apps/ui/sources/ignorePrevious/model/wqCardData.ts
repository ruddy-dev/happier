export type WqItem = Readonly<{ id: string; title: string; status: string; pr: string | null }>;
export type WqProjects = Readonly<{ names: ReadonlyMap<string, string>; knownProjectCodes: ReadonlySet<string> }>;
export type WqStage = 'plan' | 'build' | 'pr' | 'merged' | 'blocked' | 'needsYou' | null;

/** wq writes flat, unquoted `key: value` lines, not general YAML. Never project its body. */
export function parseWqItem(text: string, key: string): WqItem | null {
    const opening = /^---\r?\n/.exec(text);
    if (!opening) return null;
    const closing = /^---\r?$/m.exec(text.slice(opening[0].length));
    if (!closing) return null;
    const fields = new Map<string, string>();
    for (const line of text.slice(opening[0].length, opening[0].length + closing.index).split(/\r?\n/)) {
        const colon = line.indexOf(':');
        if (colon < 0) continue;
        const name = line.slice(0, colon).trim();
        if (!['id', 'title', 'status', 'pr'].includes(name)) continue;
        if (fields.has(name)) return null;
        fields.set(name, line.slice(colon + 1).trim());
    }
    const id = fields.get('id');
    const title = fields.get('title');
    const status = fields.get('status');
    if (id !== key || !title || !status) return null;
    return { id, title, status, pr: fields.get('pr') || null };
}

export function parseWqProjects(text: string): WqProjects | null {
    let value: unknown;
    try { value = JSON.parse(text); } catch { return null; }
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const names = new Map<string, string>();
    for (const [code, entry] of Object.entries(value)) {
        if (!/^[A-Z]{2,5}$/.test(code) || code.trim() !== code || !entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
        const name: unknown = Reflect.get(entry, 'name');
        if (typeof name === 'string' && name.trim()) names.set(code, name.trim());
    }
    return { names, knownProjectCodes: new Set(names.keys()) };
}

export function wqStage(status: string): WqStage {
    switch (status) {
        case 'ready': return 'plan';
        case 'active': return 'build';
        case 'review': return 'pr';
        case 'done': return 'merged';
        case 'blocked': return 'blocked';
        case 'needs-luke': return 'needsYou';
        default: return null;
    }
}

function trimDirectory(dir: string): string {
    return dir.replace(/\\/g, '/').replace(/\/+$/, '');
}

export function wqDirectory(explicit: string | null | undefined, coordinator: string | null): string | null {
    if (explicit?.trim()) return trimDirectory(explicit.trim()) || '/';
    return coordinator?.trim() ? `${trimDirectory(coordinator.trim())}/work` : null;
}

/** This is the only item-path builder. No unvalidated session-derived text reaches a read. */
export function wqItemPath(dir: string, key: string, codes: ReadonlySet<string>): string | null {
    const match = /^[A-Z]{2,5}-\d{1,6}$/.exec(key);
    if (!match || match[0] !== key || !codes.has(key.slice(0, key.indexOf('-')))) return null;
    return `${trimDirectory(dir)}/items/${key}.md`;
}
