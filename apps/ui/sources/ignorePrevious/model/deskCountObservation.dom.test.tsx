/** @vitest-environment jsdom */
import { createContext, runInContext } from 'node:vm';
import { expect, it } from 'vitest';

// Exercise the shared testkit owner using the UI package's existing jsdom environment.
import { observeDeskCounts } from '../../../../../packages/tests/src/testkit/deskTest/deskCountObservation';

type ObservationPage = Parameters<typeof observeDeskCounts>[0];

// Only the Playwright transport is substituted. DOM nodes, MutationRecords and
// microtask delivery use jsdom, including multiple mutations in one callback.
function browser() {
    const scripts: string[] = [];
    const bindings: Record<string, (...args: unknown[]) => unknown> = {};
    let realm = createContext({});
    let doc: Document;
    const page = {
        addInitScript: async (fn: () => void) => { scripts.push(`(${fn.toString()})()`); },
        exposeFunction: async (name: string, fn: (...args: unknown[]) => unknown) => { bindings[name] = fn; },
        evaluate: async (fn: () => unknown) => runInContext(`(${fn.toString()})()`, realm),
    } as unknown as ObservationPage;
    return {
        page,
        navigate() {
            doc = document.implementation.createHTMLDocument();
            realm = createContext({ ...bindings, document: doc, MutationObserver, Node });
            runInContext('window = globalThis', realm);
            for (const script of scripts) runInContext(script, realm);
        },
        paint(agents: string, approvals: string) {
            if (!doc.querySelector('[data-testid="ip-count-all"]')) {
                doc.body.innerHTML = '<span data-testid="ip-count-all"></span><button data-testid="ip-approvals-open"><span data-testid="ip-approvals-count"></span></button>';
            }
            doc.querySelector('[data-testid="ip-count-all"]')!.textContent = agents;
            doc.querySelector('[data-testid="ip-approvals-count"]')!.textContent = approvals;
        },
        get document() { return doc; },
    };
}

it('retains an earlier false zero across restore-root and desk documents', async () => {
    const h = browser();
    const read = await observeDeskCounts(h.page);
    h.navigate(); // ordinary restore document, before any desk paint
    h.paint('–', '– requests');
    h.paint('0', '0 requests'); // a bad first desk projection must remain evidence
    await read(); // navigation flushes the old document
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

it.each(['characterData', 'childList'] as const)('retains coalesced %s false zero before delivery', async kind => {
    const h = browser();
    const read = await observeDeskCounts(h.page);
    h.navigate();
    h.paint('–', '– requests');
    await read();
    const records: MutationRecord[] = [];
    const evidence = new MutationObserver(batch => records.push(...batch));
    evidence.observe(h.document, { subtree: true, childList: true, characterData: true, characterDataOldValue: true });
    if (kind === 'characterData') {
        const agents = h.document.querySelector('[data-testid="ip-count-all"]')!.firstChild!;
        const approvals = h.document.querySelector('[data-testid="ip-approvals-count"]')!.firstChild!;
        agents.nodeValue = '0';
        approvals.nodeValue = '0 requests';
        agents.nodeValue = '3';
        approvals.nodeValue = '1 request';
    } else {
        h.paint('0', '0 requests');
        h.paint('3', '1 request');
    }
    // No awaited turn between zero and the final value. The actual callback sees
    // final DOM text; only the records retain the omitted transition.
    expect(h.document.querySelector('[data-testid="ip-count-all"]')!.textContent).toBe('3');
    expect(await read()).toEqual({ agents: ['–', '0', '3'], approvals: ['– requests', '0 requests', '1 request'] });
    expect(records.map(record => record.type)).toEqual([kind, kind, kind, kind]);
    if (kind === 'characterData') expect(records.map(record => record.oldValue)).toEqual(['–', '– requests', '0', '0 requests']);
    else expect(records.map(record => record.removedNodes[0]?.textContent)).toEqual(['–', '– requests', '0', '0 requests']);
    evidence.disconnect();
});

it('retains character-data history when a later mutation detaches the text node', async () => {
    const h = browser();
    const read = await observeDeskCounts(h.page);
    h.navigate();
    h.paint('–', '– requests');
    await read();
    const agents = h.document.querySelector('[data-testid="ip-count-all"]')!.firstChild!;
    agents.nodeValue = '0';
    agents.nodeValue = '2';
    h.paint('3', '1 request');
    expect((await read()).agents).toEqual(['–', '0', '2', '3']);
});

it('retains replaced count subtrees and sanitizes labels without observing unrelated text', async () => {
    const h = browser();
    const read = await observeDeskCounts(h.page);
    h.navigate();
    h.paint('0', '0 requests');
    h.document.body.replaceChildren();
    h.paint('unexpected fixture text', '1 request');
    h.paint('3', '1 request');
    const unrelated = h.document.createElement('p');
    unrelated.textContent = 'unrelated fixture text';
    h.document.body.appendChild(unrelated);
    expect(await read()).toEqual({ agents: ['0', 'unexpected-count', '3'], approvals: ['0 requests', '1 request'] });
});
