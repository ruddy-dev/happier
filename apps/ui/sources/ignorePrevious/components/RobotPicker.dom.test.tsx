/** @vitest-environment jsdom */
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MMKV } from 'react-native-mmkv';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readReactNativeMmkvStubEntries } from '@/dev/testkit/mocks/mmkv';
import { deskPrefs } from '../deskPrefs';
import { terminalPalettes, type TerminalPalette } from '../palette';
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

it('keeps selection, its caption and persistence unchanged when an unchecked radio receives focus', async () => {
    await act(async () => root.render(<RobotPicker />));
    const before = readReactNativeMmkvStubEntries();
    const caption = option('ip-robot-caption-codex').textContent;
    await act(async () => option('ip-codex-robot-loupe').focus());
    expect(document.activeElement).toBe(option('ip-codex-robot-loupe'));
    selected('codex', 'ip-codex-robot-model');
    expect(option('ip-robot-caption-codex').textContent).toBe(caption);
    expect(readReactNativeMmkvStubEntries()).toEqual(before);
});

it('draws legible whole-pixel choices and larger selected previews, including every member of the model trio', async () => {
    await act(async () => root.render(<RobotPicker />));
    function artwork(id: string, count: number, minimumCell: number) {
        // SVG primitives are the native graphics boundary stub. Inspect the actual drawing geometry,
        // not WorkerSprite props or CSS sizing, so shrinking the grid inside a large slot fails too.
        const drawings = option(id).querySelectorAll('[testid="ip-sprite-pixels"]');
        expect(drawings).toHaveLength(count);
        for (const drawing of drawings) {
            const cells = drawing.querySelectorAll('rect');
            expect(cells.length).toBeGreaterThan(0);
            for (const cell of cells) {
                for (const field of ['x', 'y', 'width', 'height']) {
                    expect(Number.isInteger(Number(cell.getAttribute(field)))).toBe(true);
                }
                expect(Number(cell.getAttribute('height'))).toBeGreaterThanOrEqual(minimumCell);
            }
        }
    }
    for (const id of ['ip-no-worker-droid', 'ip-no-worker-ipb', 'ip-codex-robot-prompt', 'ip-codex-robot-loupe', 'ip-codex-robot-lab']) {
        artwork(id, 1, 2);
    }
    artwork('ip-codex-robot-model', 3, 2);
    artwork('ip-robot-preview-unassigned', 1, 3);
    artwork('ip-robot-preview-codex', 3, 3);
    await act(async () => option('ip-codex-robot-lab').click());
    artwork('ip-robot-preview-codex', 1, 3);
});

it('repaints the preview outlines for the selected Terminal palette without changing either role choice', async () => {
    await act(async () => {
        deskPrefs.set('chatStyle', 'terminal');
        root.render(<RobotPicker />);
    });
    for (const name of Object.keys(terminalPalettes) as TerminalPalette[]) {
        await act(async () => deskPrefs.set('terminalPalette', name));
        for (const role of ['unassigned', 'codex']) {
            const drawings = option(`ip-robot-preview-${role}`).querySelectorAll('[testid="ip-sprite-pixels"]');
            for (const drawing of drawings) {
                expect([...drawing.querySelectorAll('rect')].map(cell => cell.getAttribute('fill'))).toContain(terminalPalettes[name].off);
            }
        }
        selected('unassigned', 'ip-no-worker-droid');
        selected('codex', 'ip-codex-robot-model');
    }
});
