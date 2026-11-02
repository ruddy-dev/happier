/** @vitest-environment jsdom */
import * as React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';

// Exercise real React Native Web DOM output instead of the native host-element stub.
vi.mock('react-native', async () => vi.importActual('react-native-web'));

import { DeskText } from './DeskText';
import { DESK_FONT_STACK } from '../fonts/deskFont';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it('renders the desk font without inherited root styles and preserves caller weight', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    try {
        await act(async () => root.render(<DeskText style={{ fontWeight: '700' }}>Desk text</DeskText>));
        const text = container.querySelector<HTMLElement>('div')!;
        expect(text.textContent).toBe('Desk text');
        expect(text.style.fontFamily).toBe(DESK_FONT_STACK);
        expect(text.style.fontWeight).toBe('700');
    } finally {
        await act(async () => root.unmount());
        container.remove();
    }
});
