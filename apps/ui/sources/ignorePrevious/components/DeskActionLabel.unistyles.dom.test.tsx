/** @vitest-environment jsdom */
import * as React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { CoordinatorComposerInputContext, createCoordinatorComposerObserver } from '../model/coordinatorComposerInput';
import { DESK_FONT_STACK } from '../fonts/deskFont';
import { DeskActionLabel } from './DeskActionLabel';
import { loadInstalledUnistyles } from './DeskActionLabel.unistyles.test-support.mjs';

const captured = vi.hoisted(() => ({ style: undefined as unknown }));
vi.mock('react-native', async () => vi.importActual('react-native-web'));
vi.mock('@/components/ui/text/Text', () => ({ Text: (props: { style: unknown }) => { captured.style = props.style; return null; } }));

afterEach(() => vi.unstubAllGlobals());

it('preserves the terminal font override through the real Unistyles resolver', async () => {
    vi.stubGlobal('matchMedia', (media: string) => Object.assign(new EventTarget(), {
        matches: false, media, onchange: null, addListener() {}, removeListener() {},
    }));
    const { create, services } = await loadInstalledUnistyles();
    const sheet = create({ label: { fontFamily: 'Inter-SemiBold', fontSize: 13, color: '#767676' } });
    const container = document.createElement('div');
    const root = createRoot(container);
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    await act(async () => root.render(<CoordinatorComposerInputContext.Provider value={{
        observer: createCoordinatorComposerObserver(), prompt: null, panelFooter: null, panelLeading: null, terminal: true,
    }}><DeskActionLabel label="Plan" style={sheet.label} /></CoordinatorComposerInputContext.Provider>));
    const styles = Array.isArray(captured.style) ? captured.style : [captured.style];
    const resolved = services.shadowRegistry.addStyles(styles).parsedStyles;
    await act(async () => root.unmount());
    expect(resolved?.fontFamily).toBe(DESK_FONT_STACK);
    expect(resolved?.fontSize).toBe(13);
    expect(resolved?.color).toBe('#767676');
});
