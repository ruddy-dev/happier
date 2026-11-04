import { createContext, runInContext } from 'node:vm';
import type { Page } from '@playwright/test';
import { expect, it } from 'vitest';

import { observeDeskCounts } from './deskCountObservation';

// Browser/document boundary only. Each navigation destroys its globals and observer.
function browser() {
    const scripts: string[] = [];
    const bindings: Record<string, (...args: unknown[]) => unknown> = {};
    let realm = createContext({});
    let paint = (_agents: string, _approvals: string) => {};
    const page = {
        addInitScript: async (fn: () => void) => { scripts.push(`(${fn.toString()})()`); },
        exposeFunction: async (name: string, fn: (...args: unknown[]) => unknown) => { bindings[name] = fn; },
        evaluate: async (fn: () => unknown) => runInContext(`(${fn.toString()})()`, realm),
    } as unknown as Page;
    return {
        page,
        navigate() {
            let agents: string | undefined;
            let approvals: string | undefined;
            let mutation = () => {};
            realm = createContext({
                ...bindings,
                document: { querySelector: (selector: string) => {
                    const textContent = selector.includes('ip-count-all') ? agents : approvals;
                    return textContent === undefined ? null : { textContent };
                } },
                MutationObserver: class {
                    constructor(callback: () => void) { mutation = callback; }
                    observe() {}
                },
            });
            runInContext('window = globalThis', realm);
            for (const script of scripts) runInContext(script, realm);
            paint = (a, b) => { agents = a; approvals = b; mutation(); };
        },
        paint: (agents: string, approvals: string) => paint(agents, approvals),
    };
}

it('retains an earlier false zero across restore-root and desk documents', async () => {
    const h = browser();
    const read = await observeDeskCounts(h.page);
    h.navigate(); // ordinary restore document, before any desk paint
    h.paint('–', '– requests');
    h.paint('0', '0 requests'); // a bad first desk projection must remain evidence
    h.navigate(); // normal /desk navigation must never erase it
    h.paint('3', '1 request');
    expect(await read()).toEqual({ agents: ['–', '0', '3'], approvals: ['– requests', '0 requests', '1 request'] });
});

it('captures first paint after navigation and same-document restore without priming', async () => {
    const h = browser();
    const read = await observeDeskCounts(h.page);
    h.navigate();
    h.paint('0', '0 requests');
    h.paint('3', '1 request');
    expect((await read()).agents).toEqual(['0', '3']);
});
