/** @vitest-environment jsdom */
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MMKV } from 'react-native-mmkv';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readReactNativeMmkvStubEntries } from '@/dev/testkit/mocks/mmkv';
import { RobotPicker } from './RobotPicker';

// Keep the real RN Web Pressable and DOM adapter: the native host stub hides missing ARIA state.
vi.mock('react-native', async () => vi.importActual('react-native-web'));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
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
function selected(group: 'unassigned' | 'codex', choice: string) {
    const radios = container.querySelectorAll<HTMLElement>(`[data-testid="ip-robot-picker-${group}"] [role="radio"]`);
    expect(radios).toHaveLength(group === 'unassigned' ? 2 : 4);
    for (const radio of radios) {
        const checked = radio.dataset.testid === choice;
        expect(radio.getAttribute('aria-checked'), radio.dataset.testid).toBe(String(checked));
        expect(radio.tabIndex).toBe(checked ? 0 : -1);
        expect(radio.getAttribute('aria-label')).toBeTruthy();
    }
}
async function key(id: string, value: string) {
    await act(async () => {
        const radio = option(id);
        radio.focus();
        radio.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true }));
        radio.dispatchEvent(new KeyboardEvent('keyup', { key: value, bubbles: true, cancelable: true }));
    });
}

it('announces defaults and keyboard selection independently in both real RN Web radio groups', async () => {
    await act(async () => root.render(<RobotPicker />));
    expect(container.querySelectorAll('[role="radiogroup"]')).toHaveLength(2);
    selected('unassigned', 'ip-no-worker-droid');
    selected('codex', 'ip-codex-robot-model');

    await key('ip-no-worker-droid', 'ArrowRight');
    selected('unassigned', 'ip-no-worker-ipb');
    selected('codex', 'ip-codex-robot-model');
    expect(document.activeElement).toBe(option('ip-no-worker-ipb'));

    await key('ip-codex-robot-model', 'ArrowDown');
    selected('codex', 'ip-codex-robot-prompt');
    selected('unassigned', 'ip-no-worker-ipb');
    expect(document.activeElement).toBe(option('ip-codex-robot-prompt'));
    await key('ip-codex-robot-prompt', 'ArrowLeft');
    selected('codex', 'ip-codex-robot-model');
    await key('ip-codex-robot-model', 'ArrowUp');
    selected('codex', 'ip-codex-robot-lab');
    await key('ip-codex-robot-lab', 'Home');
    selected('codex', 'ip-codex-robot-model');
    await key('ip-codex-robot-model', 'End');
    selected('codex', 'ip-codex-robot-lab');
    await key('ip-codex-robot-loupe', ' ');
    selected('codex', 'ip-codex-robot-loupe');
    selected('unassigned', 'ip-no-worker-ipb');
    await key('ip-codex-robot-prompt', 'Enter');
    selected('codex', 'ip-codex-robot-prompt');
    await act(async () => option('ip-no-worker-droid').click());
    selected('unassigned', 'ip-no-worker-droid');
    selected('codex', 'ip-codex-robot-prompt');

    await act(async () => root.render(null));
    await act(async () => root.render(<RobotPicker />));
    selected('codex', 'ip-codex-robot-prompt');
    selected('unassigned', 'ip-no-worker-droid');
});

it('announces safe defaults for unknown stored choices without rewriting them on mount', async () => {
    const persisted = new MMKV();
    persisted.set('ignorePrevious.noWorkerRobot', 'future');
    persisted.set('ignorePrevious.codexRobot', 'future');
    const before = readReactNativeMmkvStubEntries();
    await act(async () => root.render(<RobotPicker />));
    selected('unassigned', 'ip-no-worker-droid');
    selected('codex', 'ip-codex-robot-model');
    expect(readReactNativeMmkvStubEntries()).toEqual(before);
});
