/** @vitest-environment jsdom */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { DeskCreature } from './DeskCreature.web';
import { creatureLabel } from './creatureLabel';

// Simulate the browser failing to fetch the lazy engine chunk, before engine code can run.
vi.mock('./creature', () => { throw new Error('Engine chunk unavailable'); });
vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock();
});
vi.mock('@/hooks/ui/useReducedMotionPreference', async () => {
    const { createReducedMotionModuleMock } = await import('@/dev/testkit/mocks/reducedMotion');
    return createReducedMotionModuleMock(() => false);
});

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class Boundary extends React.Component<React.PropsWithChildren, { failed: boolean }> {
    state = { failed: false };
    static getDerivedStateFromError() { return { failed: true }; }
    render() { return this.state.failed ? <output>Engine error escaped</output> : this.props.children; }
}

it('F4 a failed engine chunk renders a labelled static mask without taking down its parent', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    try {
        await act(async () => root.render(<Boundary><DeskCreature style="slips" redEyes={1} mode="working" /></Boundary>));
        await act(async () => vi.dynamicImportSettled());
        const creature = container.querySelector('[data-testid="ip-creature"]');
        expect(creature).not.toBeNull();
        expect(creature?.getAttribute('aria-label')).toBe(creatureLabel('working', false));
        expect(creature?.querySelector('svg')).not.toBeNull();
        expect(creature?.querySelector('canvas')).toBeNull();
        await act(async () => root.render(<Boundary><DeskCreature style="terminal" redEyes={2} mode="burst" /></Boundary>));
        expect(creature?.getAttribute('aria-label')).toBe(creatureLabel('burst', false));
    } finally {
        await act(async () => root.unmount());
        container.remove();
    }
});
