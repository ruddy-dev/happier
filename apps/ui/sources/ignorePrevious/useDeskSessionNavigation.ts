import { useCallback, useContext } from 'react';

import { useNavigateToSession, type NavigateToSessionOptions } from '@/hooks/session/useNavigateToSession';
import { Modal } from '@/modal';
import { t } from '@/text';
import { DeskDemoContext } from './deskFixtureGate';

/** Demo sessions exist only in memory; the live desk delegates to Happier's session owner. */
export function useDeskSessionNavigation() {
    const demo = useContext(DeskDemoContext);
    const navigate = useNavigateToSession();
    return useCallback((sessionId: string, options?: NavigateToSessionOptions) => {
        if (demo) {
            Modal.alert(t('ignorePrevious.demo.noteTitle'), t('ignorePrevious.demo.openWorkerNote'));
            return;
        }
        return navigate(sessionId, options);
    }, [demo, navigate]);
}
