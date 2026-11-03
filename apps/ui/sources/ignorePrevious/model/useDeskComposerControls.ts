import * as React from 'react';
import type { SessionViewComposerOverrides } from '@/components/sessions/model/sessionComposerOverrides';
import { useSession } from '@/sync/store/hooks';
import { getSessionStatus } from '@/utils/sessions/sessionUtils';
import { isDeskWorkerBusy } from './workerBusy';
import { useDeskNow } from './useDeskNow';

const continuationInputPermissionModes = { codex: 'read-only', claude: 'plan' } as const;

/** SessionView retains send/admission ownership; the desk supplies its required intent. */
export function useDeskComposerControls(sessionId: string): SessionViewComposerOverrides {
    const session = useSession(sessionId);
    const now = useDeskNow();
    const sendIsStop = session ? isDeskWorkerBusy(getSessionStatus(session, now).state) : false;
    return React.useMemo(() => ({ sendIsStop, mic: null, hide: { stop: true }, continuationInputPermissionModes }), [sendIsStop]);
}
