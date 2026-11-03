import * as React from 'react';

import { ModalProvider } from '@/modal/ModalProvider';
import { AppPaneProvider } from '@/components/appShell/panes/AppPaneProvider';
import { useDeskPageModalAppearance } from '@/ignorePrevious/appearance/DeskPageModalAppearance';

export function AppPaneModalProvider(props: Readonly<{ children: React.ReactNode }>) {
    const modalContentWrapper = useDeskPageModalAppearance();
    // ModalProvider uses an overlay-portal host to render popovers/modals on native. If AppPaneProvider
    // is nested inside ModalProvider, those overlay nodes render outside the pane provider and lose
    // pane context. Keep AppPaneProvider outside to preserve pane context across overlay portals.
    return (
        <AppPaneProvider>
            <ModalProvider modalContentWrapper={modalContentWrapper}>{props.children}</ModalProvider>
        </AppPaneProvider>
    );
}
