import * as React from 'react';
import { View } from 'react-native';

/**
 * Module factories for the two pieces of DeskScreen that leave the desk: Happier's chat surface and
 * the route hook that fetches a session record. `vi.mock` is hoisted per file, so each desk test file
 * declares these itself (copied from `DeskScreen.test.tsx`):
 *
 *     vi.mock('@/components/sessions/shell/SessionView', async () =>
 *         (await import('@/ignorePrevious/testkit/deskScreenMocks')).deskScreenMocks.sessionView());
 *
 * This file must not import the desk, or the factory would load the module it replaces.
 */
export const deskScreenMocks = {
    /** SessionView is Happier's whole chat (transcript, composer, sockets); the desk only places it. */
    sessionView: () => ({
        SessionView: ({ id, routeHydrationState }: { id: string; routeHydrationState?: { kind: string } | null }) => (
            <View testID={`session-view-${id}`} accessibilityHint={routeHydrationState?.kind ?? 'none'} />
        ),
    }),
    /** Fetching a record the store doesn't hold goes over the network; report it as already there. */
    hydrateSessionForRoute: () => ({
        useHydrateSessionForRoute: (sessionId: string) => ({ kind: 'available' as const, sessionId }),
    }),
};
