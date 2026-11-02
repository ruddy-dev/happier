import * as React from 'react';
import { Redirect, Stack } from 'expo-router';

import { DeskScreen } from '@/ignorePrevious/screens/DeskScreen';

/**
 * Dev-only route: the real desk over a fixed scenario written into the store, with no server.
 * It exists only in builds made with EXPO_PUBLIC_IP_FIXTURES=1; otherwise it redirects home, and the
 * fixtures folder is left out of the bundle (Metro's block list, and the dead branch below). The
 * ship guard greps the built output for the fixture marker.
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
    const [ready, setReady] = React.useState(false);
    const [failure, setFailure] = React.useState<unknown>(null);
    React.useEffect(() => {
        let live = true;
        loadFixture().then(
            ({ applyDeskFixture }) => {
                // The store is filled before DeskScreen mounts, so its first render already has the desk.
                if (!live) return;
                applyDeskFixture();
                setReady(true);
            },
            (error: unknown) => {
                if (live) setFailure(error);
            },
        );
        return () => {
            live = false;
        };
    }, []);
    if (failure) throw failure;
    return ready ? <DeskScreen /> : null;
}

// A module constant, not an inline literal: a new object each render makes the stack re-apply the options.
const SCREEN_OPTIONS = { title: 'Desk fixture' };

export default function DeskFixturePage() {
    if (process.env.EXPO_PUBLIC_IP_FIXTURES !== '1') return <Redirect href="/" />;
    return (
        <>
            <Stack.Screen options={SCREEN_OPTIONS} />
            <FixtureDesk />
        </>
    );
}
