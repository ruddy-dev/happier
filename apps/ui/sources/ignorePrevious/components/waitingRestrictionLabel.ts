import { t } from '@/text';
import type { WaitingDisabledReason } from '../model/waitingItems';

/** Presentation only: the canonical wait projection owns rights and count membership. */
export function waitingRestrictionLabel(reason: WaitingDisabledReason): string | null {
    if (reason === 'readOnly') return t('ignorePrevious.waiting.viewOnly');
    if (reason === 'notGranted') return t('ignorePrevious.waiting.cannotApprove');
    return null;
}
