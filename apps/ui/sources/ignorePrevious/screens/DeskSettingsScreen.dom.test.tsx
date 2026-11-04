/** @vitest-environment jsdom */
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { readReactNativeMmkvStubEntries } from '@/dev/testkit/mocks/mmkv';
import { deskPrefs } from '../deskPrefs';
import { DeskSettingsScreen } from './DeskSettingsScreen';

// Exercise the installed web host: the native test renderer retains props that RN Web drops.
vi.mock('react-native', async () => vi.importActual('react-native-web'));

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
});
afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
});

function option(id: string): HTMLElement {
    const node = container.querySelector<HTMLElement>(`[data-testid="${id}"]`);
    expect(node, id).not.toBeNull();
    return node!;
}

function selected(id: string, checked: boolean, role = 'radio') {
    expect(option(id).getAttribute('role')).toBe(role);
    expect.soft(option(id).getAttribute('aria-checked'), id).toBe(String(checked));
}

it('announces both chat styles before and after real presses and restores the persisted selection', async () => {
    await act(async () => root.render(<DeskSettingsScreen />));
    expect(readReactNativeMmkvStubEntries()).toEqual([]);
    selected('ip-chat-style-mask', true);
    selected('ip-chat-style-terminal', false);

    for (const style of ['terminal', 'mask'] as const) {
        await act(async () => option(`ip-chat-style-${style}`).click());
        expect(deskPrefs.get('chatStyle')).toBe(style);
        expect(readReactNativeMmkvStubEntries()).toContainEqual(['ignorePrevious.chatStyle', style]);
        selected('ip-chat-style-mask', style === 'mask');
        selected('ip-chat-style-terminal', style === 'terminal');
        await act(async () => root.render(null));
        await act(async () => root.render(<DeskSettingsScreen />));
        selected(`ip-chat-style-${style}`, true);
    }
});

it('announces palette, face, robot swatch and creature selection changes through the same web host', async () => {
    await act(async () => root.render(<DeskSettingsScreen />));
    await act(async () => option('ip-chat-style-terminal').click());
    for (const [before, after] of [
        ['ip-chat-palette-tokyo', 'ip-chat-palette-gruvbox'],
        ['ip-faces-A', 'ip-faces-B'],
        ['ip-robot-droid-purple', 'ip-robot-droid-steel'],
    ]) {
        selected(before, true);
        selected(after, false);
        await act(async () => option(after).click());
        selected(before, false);
        selected(after, true);
    }
    selected('ip-settings-creature', true, 'switch');
    await act(async () => option('ip-settings-creature').click());
    expect(deskPrefs.get('creatureEnabled')).toBe(false);
    selected('ip-settings-creature', false, 'switch');
});
