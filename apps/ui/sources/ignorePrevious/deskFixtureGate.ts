import * as React from 'react';

/**
 * True in a build made with EXPO_PUBLIC_IP_FIXTURES=1, and only then: unset, empty, `0` and anything else
 * is off. Metro inlines the env value wherever it is read, so this reads right in a bundle.
 *
 * Gates that guard an `import()` of the fixtures folder (the route, CoordinatorPane) spell the comparison
 * out instead of calling this: Metro folds `process.env.X === '1'` away in a production build, but it does
 * not fold a function call, and the import has to fold away with the flag.
 */
export function isDeskFixtureBuild(): boolean {
    return process.env.EXPO_PUBLIC_IP_FIXTURES === '1';
}

/** True under the dev-only desk fixture route, so the stub coordinator body shows there and nowhere else. */
export const DeskFixtureRouteContext = React.createContext(false);

/** Public sample presentation, supplied only by the fixture route with data=demo. */
export const DeskDemoContext = React.createContext(false);

// Sync ends the fixture synchronously before activating an account's persistence scope.
// The callback keeps fixture data/imports out of the normal build's dependency graph.
let activeFixtureRelease: (() => void) | null = null;

export function releaseDeskFixture(): void {
    const release = activeFixtureRelease;
    activeFixtureRelease = null;
    release?.();
}

export function registerDeskFixtureRelease(release: () => void): () => void {
    activeFixtureRelease = release;
    return () => {
        if (activeFixtureRelease === release) activeFixtureRelease = null;
    };
}
