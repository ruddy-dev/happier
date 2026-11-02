import * as React from 'react';
import { Redirect, Stack } from 'expo-router';
import { useUnistyles } from 'react-native-unistyles';
import { View } from 'react-native';

import { useAuth } from '@/auth/context/AuthContext';
import { Text } from '@/components/ui/text/Text';
import { DeskFixtureRouteContext, isDeskFixtureBuild } from '@/ignorePrevious/deskFixtureGate';
import { DeskScreen } from '@/ignorePrevious/screens/DeskScreen';
import { storage } from '@/sync/domains/state/storage';
import { resolveWarmCacheAccountScope } from '@/sync/domains/state/warmCachePersistence';
import { useProfile } from '@/sync/store/hooks';

/**
 * Dev-only route: the real desk over a fixed scenario written into the store, with no server.
 * It exists only in builds made with EXPO_PUBLIC_IP_FIXTURES=1; otherwise it redirects home, and the
 * fixtures folder is left out of the bundle (Metro's block list, and the dead branch below). The
 * ship guard greps the built output for the fixture marker.
 *
 * It never seeds over a signed-in account (the store would mix fake sessions into the real list and the
 * account's warm cache), and it takes its sessions out again when the route is left or credentials arrive.
 */
function loadFixture(): Promise<typeof import('@/ignorePrevious/fixtures/applyDeskFixture')> {
    // The import sits inside this check so a build without the flag folds it away. It also sits inside a
    // try block on purpose: Metro treats an import in a try block as optional, so a dev bundle made without
    // the flag (which does not fold the check, and whose block list hides the fixtures) still builds.
    if (process.env.EXPO_PUBLIC_IP_FIXTURES === '1') {
        try {
            return import('@/ignorePrevious/fixtures/applyDeskFixture');
        } catch (error) {
            return Promise.reject(new Error('Desk fixture could not be loaded', { cause: error }));
        }
    }
    return Promise.reject(new Error('Desk fixture is switched off'));
}

function FixtureDesk() {
    const auth = useAuth();
    const profile = useProfile();
    const signedIn = auth.isAuthenticated || auth.credentials != null || Boolean(profile.id);
    const [ready, setReady] = React.useState(false);
    const [failure, setFailure] = React.useState<unknown>(null);
    React.useEffect(() => {
        if (signedIn) return;
        let live = true;
        let release: (() => void) | null = null;
        loadFixture()
            .then(({ applyDeskFixture }) => {
                // The store is filled before DeskScreen mounts, so its first render already has the desk.
                if (!live || resolveWarmCacheAccountScope(storage.getState().profile.id)) return;
                release = applyDeskFixture();
                setReady(true);
            })
            .catch((error: unknown) => {
                if (live) setFailure(error);
            });
        return () => {
            live = false;
            release?.();
            setReady(false);
        };
    }, [signedIn]);
    if (failure) throw failure;
    if (signedIn) return <SignedInNotice />;
    return ready ? (
        <DeskFixtureRouteContext.Provider value={true}>
            <DeskScreen />
        </DeskFixtureRouteContext.Provider>
    ) : null;
}

// Dev-only screen: plain English, like the route title, and nothing a user of a normal build can reach.
function SignedInNotice() {
    const { theme } = useUnistyles();
    return (
        <View testID="ip-fixture-signed-in" style={{ flex: 1, padding: 24, justifyContent: 'center' }}>
            <Text style={{ color: theme.colors.text.primary, fontSize: 16 }}>
                The desk fixture only runs signed out, because it writes made-up sessions into the store. Sign out, or open
                this route in a profile that has no account.
            </Text>
        </View>
    );
}

// A module constant, not an inline literal: a new object each render makes the stack re-apply the options.
const SCREEN_OPTIONS = { title: 'Desk fixture' };

export default function DeskFixturePage() {
    if (!isDeskFixtureBuild()) return <Redirect href="/" />;
    return (
        <>
            <Stack.Screen options={SCREEN_OPTIONS} />
            <FixtureDesk />
        </>
    );
}
