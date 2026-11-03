/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest';
import { DESK_FONT_ROUTES, mountDeskFont } from './deskFont';

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

// ATR-56 / 1.22: exact route membership must not style neighboring Happier pages.
describe('desk look route scoping', () => {
    it.each(['/', '/restore/manual', '/settings/voice'])('includes %s', (route) => {
        expect(DESK_FONT_ROUTES.includes(route)).toBe(true);
    });
    it.each(['/session/example', '/settings', '/settings/voice/extra', '/restore', '/restore/lost-access', '/restore/show-qr', '/setup'])('excludes %s', (route) => {
        expect(DESK_FONT_ROUTES.includes(route)).toBe(false);
    });
});

it('scopes terminal control geometry and phone copy backing to their owning routes', () => {
    const doc = document;
    const unmount = mountDeskFont(doc);
    const sheet = doc.querySelector('style')!.sheet!;
    const rules = Array.from(sheet.cssRules);
    const geometry = rules.filter((rule): rule is CSSStyleRule => rule instanceof CSSStyleRule && rule.style.getPropertyValue('border-radius') === '2px');
    const phone = rules.find((rule): rule is CSSMediaRule => rule instanceof CSSMediaRule && rule.conditionText.includes('720px'));
    expect(phone).toBeDefined();
    const backing = Array.from(phone!.cssRules).find((rule): rule is CSSStyleRule => rule instanceof CSSStyleRule && rule.cssText.includes('background-color: var(--ip-page-surface)'));
    expect(backing).toBeDefined();
    const scope = doc.createElement('div');
    scope.setAttribute('data-ip-page-scope', '');
    scope.setAttribute('data-ip-terminal', '');
    scope.innerHTML = '<div data-testid="welcome-decision-panel"><div data-testid="welcome-heading-group"><div data-testid="welcome-question-title"></div></div><div data-testid="welcome-signup-disabled"></div><div data-testid="welcome-server-loading-block"></div><button data-testid="welcome-primary-start"></button></div><input data-testid="restore-manual-secret-input"><button data-testid="restore-manual-submit"></button><div data-testid="ip-voice-page"><button></button></div><button data-testid="unrelated"></button>';
    doc.body.append(scope);
    const matches = (element: Element) => geometry.some(rule => element.matches(rule.selectorText));
    for (const id of ['welcome-primary-start', 'restore-manual-secret-input', 'restore-manual-submit']) expect(matches(scope.querySelector(`[data-testid="${id}"]`)!)).toBe(true);
    expect(matches(scope.querySelector('[data-testid="ip-voice-page"] button')!)).toBe(true);
    expect(matches(scope.querySelector('[data-testid="unrelated"]')!)).toBe(false);
    expect(scope.querySelector('[data-testid="welcome-heading-group"]')!.matches(backing!.selectorText)).toBe(true);
    expect(scope.querySelector('[data-testid="welcome-question-title"]')!.matches(backing!.selectorText)).toBe(false);
    for (const id of ['welcome-signup-disabled', 'welcome-server-loading-block']) {
        const notice = scope.querySelector(`[data-testid="${id}"]`)!;
        expect(notice.matches(backing!.selectorText)).toBe(true);
        expect(Array.from(phone!.cssRules).some(rule => rule instanceof CSSStyleRule && rule.style.getPropertyValue('border-radius') === '2px' && notice.matches(rule.selectorText))).toBe(true);
    }
    expect(backing!.style.padding).toBeTruthy();
    expect(backing!.style.boxShadow).toBeFalsy();
    const focusRule = rules.find((rule): rule is CSSStyleRule => rule instanceof CSSStyleRule && rule.selectorText.includes(':focus-visible'));
    expect(focusRule?.style.outline).toContain('3px');
    const input = scope.querySelector<HTMLInputElement>('[data-testid="restore-manual-secret-input"]')!;
    input.focus();
    expect(doc.activeElement).toBe(input);
    scope.removeAttribute('data-ip-terminal');
    expect(matches(scope.querySelector('[data-testid="welcome-primary-start"]')!)).toBe(false);
    scope.remove();
    unmount();
});


it('scopes Voice card and clipping geometry to Terminal without changing overflow or focus', () => {
    const unmount = mountDeskFont(document);
    const rules = Array.from(document.querySelector<HTMLStyleElement>('#ip-desk-font')!.sheet!.cssRules)
        .filter((rule): rule is CSSStyleRule => rule instanceof CSSStyleRule);
    const scope = document.createElement('div');
    scope.setAttribute('data-ip-terminal', '');
    scope.innerHTML = '<div data-testid="ip-voice-page"><div data-testid="item-group-card"><div data-testid="item-group-card-inner"><input></div></div></div><div data-testid="item-group-card"></div>';
    document.body.append(scope);
    const card = scope.querySelector('[data-testid="ip-voice-page"] [data-testid="item-group-card"]')!;
    const inner = card.querySelector('[data-testid="item-group-card-inner"]')!;
    const outside = scope.lastElementChild!;
    const matches = (element: Element) => rules.filter(rule => rule.style.getPropertyValue('border-radius') === '2px' && element.matches(rule.selectorText));
    for (const element of [card, inner]) {
        const matching = matches(element);
        expect(matching.length).toBeGreaterThan(0);
        expect(matching.some(rule => rule.style.getPropertyPriority('border-radius') === 'important')).toBe(true);
        expect(matching.every(rule => !rule.style.overflow && !rule.style.outline)).toBe(true);
    }
    expect(matches(outside)).toHaveLength(0);
    expect(matches(card.querySelector('input')!).some(rule => rule.selectorText.includes('item-group-card'))).toBe(false);
    scope.removeAttribute('data-ip-terminal');
    expect(matches(card)).toHaveLength(0);
    expect(matches(inner)).toHaveLength(0);
    scope.remove();
    unmount();
});
