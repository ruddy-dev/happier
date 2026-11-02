/** @vitest-environment jsdom */
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Platform } from 'react-native';
import { DeskFontRoot } from './DeskFontRoot';
import { DESK_FONT_STACK } from './deskFont';

const route = vi.hoisted(() => ({ pathname: '/desk' }));
vi.mock('expo-router', async () => {
    const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
    return createExpoRouterMock({ pathname: () => route.pathname }).module;
});
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let previousPlatform: typeof Platform.OS;
beforeEach(() => {
    previousPlatform = Platform.OS;
    Platform.OS = 'web';
    route.pathname = '/desk';
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
});
afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    Platform.OS = previousPlatform;
});
const render = async () => act(async () => root.render(<DeskFontRoot><span>content</span></DeskFontRoot>));

describe('desk font route root', () => {
    it('resolves the desk root to JetBrains Mono and releases the rule on route changes', async () => {
        await render();
        const deskRoot = container.querySelector('[data-ip-font="desk"]');
        expect(deskRoot).not.toBeNull();
        expect(getComputedStyle(deskRoot!).fontFamily).toBe(DESK_FONT_STACK);
        const style = document.getElementById('ip-desk-font');
        for (const pathname of ['/session/example', '/settings', '/restore']) {
            route.pathname = pathname;
            await render();
            expect(container.querySelector('[data-ip-font="desk"]')).toBeNull();
            expect(document.getElementById('ip-desk-font')).toBeNull();
        }
        route.pathname = '/desk';
        await render();
        expect(document.getElementById('ip-desk-font')).toBe(style);
    });

    it.each(['/desk/settings', '/', '/restore/manual', '/settings/voice'])('loads the shared font on %s', async (pathname) => {
        route.pathname = pathname;
        await render();
        expect(container.querySelector('[data-ip-font="desk"]')).not.toBeNull();
        expect(document.getElementById('ip-desk-font')).not.toBeNull();
    });

    it.each(['ios', 'android'] as const)('does nothing on %s, even with a document available', async (os) => {
        Platform.OS = os;
        await render();
        expect(container.querySelector('[data-ip-font]')).toBeNull();
        expect(document.getElementById('ip-desk-font')).toBeNull();
        expect(container.children).toHaveLength(1);
        expect(container.firstElementChild?.tagName).toBe('SPAN');
    });
});
