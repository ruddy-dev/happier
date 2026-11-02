import * as React from 'react';

import type { SessionListRenderableSession } from '@/sync/domains/session/listing/sessionListRenderable';

import { useDeskPref } from '../deskPrefs';
import { pickCoordinatorSessionId } from './coordinator';

/** The folder the coordinator runs in, for picking it without a stored choice. */
export const COORDINATOR_PATH = process.env.EXPO_PUBLIC_IP_COORDINATOR_PATH ?? null;

/**
 * The coordinator session for the desk's list: the stored pick while it is listed and unarchived,
 * else the newest active session in `COORDINATOR_PATH`, else null. A store outside React, not a
 * context, so a card opened through `Modal.show` sees the same id as the desk.
 */
export function useCoordinatorId(list: readonly SessionListRenderableSession[]): string | null {
    const [storedId] = useDeskPref('coordinatorSessionId');
    return React.useMemo(
        () =>
            pickCoordinatorSessionId(
                list.map((s) => ({
                    id: s.id,
                    path: s.metadata?.path ?? '',
                    active: s.active,
                    archived: Boolean(s.archivedAt),
                    updatedAt: s.updatedAt,
                })),
                { storedId, coordinatorPath: COORDINATOR_PATH },
            ),
        [list, storedId],
    );
}
