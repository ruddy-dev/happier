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
