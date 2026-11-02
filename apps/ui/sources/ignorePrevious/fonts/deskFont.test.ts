/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest';
import { mountDeskFont } from './deskFont';

// Each document is a browser boundary; no internal font logic is mocked.
describe('desk font installation', () => {
    it('writes one rule set across overlapping mounts and remounts, attached only while mounted', () => {
        const doc = document.implementation.createHTMLDocument();
        const unmountFirst = mountDeskFont(doc);
        const style = doc.head.querySelector('style');
        expect(style).not.toBeNull();
        expect(style?.textContent).toContain('font-weight: 500 700');
        const unmountSecond = mountDeskFont(doc);
        expect(doc.head.querySelectorAll('style')).toHaveLength(1);
        unmountFirst();
        expect(style?.isConnected).toBe(true);
        unmountSecond();
        expect(doc.head.querySelector('style')).toBeNull();
        const unmountAgain = mountDeskFont(doc);
        expect(doc.head.querySelector('style')).toBe(style);
        unmountAgain();
    });

    it('leaves Happier font registrations untouched', () => {
        const doc = document.implementation.createHTMLDocument();
        const upstream = doc.createElement('style');
        upstream.id = 'happier-web-font-faces';
        upstream.textContent = '@font-face { font-family: Inter-Regular; src: url("inter.ttf"); }';
        doc.head.append(upstream);
        const original = upstream.textContent;
        const unmount = mountDeskFont(doc);
        expect(doc.getElementById(upstream.id)).toBe(upstream);
        expect(upstream.textContent).toBe(original);
        expect(doc.head.querySelectorAll('style')).toHaveLength(2);
        unmount();
        expect(doc.head.children).toHaveLength(1);
        expect(upstream.textContent).toBe(original);
    });
});
