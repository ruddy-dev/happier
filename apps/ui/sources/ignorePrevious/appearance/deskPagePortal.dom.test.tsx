/** @vitest-environment jsdom */
import * as React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';

vi.mock('react-native', async () => vi.importActual('react-native-web'));
vi.mock('@react-navigation/native', async () => (
    (await import('@/dev/testkit/mocks/reactNavigation')).createReactNavigationNativeMock()
));
vi.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
    useSafeAreaFrame: () => ({ x: 0, y: 0, width: 1200, height: 900 }),
}));
// Radix is the external dialog boundary; retain its real body-portal behavior.
vi.mock('@/utils/web/radixCjs', async () => {
    const { createPortal } = await import('react-dom');
    const Pass = ({ children }: React.PropsWithChildren) => <>{children}</>;
    return {
        requireRadixDialog: () => ({
            Root: Pass, Overlay: Pass, Content: Pass, Title: Pass,
            Portal: ({ children }: React.PropsWithChildren) => createPortal(children, document.body),
        }),
        requireRadixDismissableLayer: () => ({ Branch: Pass }),
    };
});
// Match Unistyles 3's CSSVars DOM boundary. React context crosses a portal;
// CSS inheritance does not, so the portal needs its own named DOM scope.
vi.mock('react-native-unistyles', async () => ({
    ...(await (await import('@/dev/testkit/mocks/unistyles')).createUnistylesMock()),
    ScopedTheme: ({ name, children }: React.PropsWithChildren<{ name: string }>) => (
        <div data-unistyles-theme={name} style={{ display: 'contents' }}>{children}</div>
    ),
}));

import { Text, TextInput } from '@/components/ui/text/Text';
import { tryRenderWebPortal } from '@/components/ui/popover/portal';
import { DeskPageScope } from './DeskPageScope';
import { DESK_FONT_STACK } from '../fonts/deskFont';
import { BaseModal } from '@/modal/components/BaseModal';

function Portal() {
    return tryRenderWebPortal({
        shouldPortalWeb: true,
        portalTargetOnWeb: 'body',
        modalPortalTarget: null,
        getBoundaryDomElement: () => null,
        content: <div data-testid="menu"><Text testID="menu-text">Language</Text><TextInput testID="menu-search" /></div>,
    });
}

it('keeps desk typography and CSS theme scope in a body portal, without styling siblings', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    try {
        await act(async () => root.render(<>
            <Text testID="outside">Happier</Text>
            <DeskPageScope name="deskPageDark"><Portal /></DeskPageScope>
        </>));
        const menu = document.querySelector('[data-testid="menu"]')!;
        expect(menu.closest('[data-unistyles-theme]')?.getAttribute('data-unistyles-theme')).toBe('deskPageDark');
        for (const id of ['menu-text', 'menu-search']) {
            expect(document.querySelector<HTMLElement>(`[data-testid="${id}"]`)?.style.fontFamily).toBe(DESK_FONT_STACK);
        }
        expect(container.querySelector<HTMLElement>('[data-testid="outside"]')?.style.fontFamily).not.toBe(DESK_FONT_STACK);
        await act(async () => root.render(<Portal />));
        expect(document.querySelector('[data-testid="menu"]')?.closest('[data-unistyles-theme]')).toBeNull();
    } finally {
        await act(async () => root.unmount());
        container.remove();
    }
});

it('restores the CSS theme scope inside the real modal owner’s body portal', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    try {
        await act(async () => root.render(
            <DeskPageScope name="deskPageDark">
                <BaseModal visible><Text testID="modal-text">Restore error</Text></BaseModal>
            </DeskPageScope>,
        ));
        const text = document.querySelector<HTMLElement>('[data-testid="modal-text"]')!;
        expect(container.contains(text)).toBe(false);
        expect(text.closest('[data-unistyles-theme]')?.getAttribute('data-unistyles-theme')).toBe('deskPageDark');
        expect(text.style.fontFamily).toBe(DESK_FONT_STACK);
    } finally {
        await act(async () => root.unmount());
        container.remove();
    }
});


it('keeps the local font installed for the lifetime of a page or dialog scope', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    try {
        await act(async () => root.render(<DeskPageScope name="deskPageLight"><Text>Retained dialog</Text></DeskPageScope>));
        expect(document.getElementById('ip-desk-font')).not.toBeNull();
        await act(async () => root.render(<Text>Ordinary page</Text>));
        expect(document.getElementById('ip-desk-font')).toBeNull();
    } finally {
        await act(async () => root.unmount());
        container.remove();
    }
});
