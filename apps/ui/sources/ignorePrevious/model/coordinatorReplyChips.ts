import type { AgentState } from '@/sync/domains/state/storageTypes';
import { resolveWaitingQuestions } from './waitingQuestions';

/** Only an unambiguous ordinary question offers drafts; parsing stays with the Waiting owner. */
export function resolveCoordinatorReplyChips(requests: AgentState['requests'] | null): readonly string[] {
    const pending = Object.values(requests ?? {});
    if (pending.length !== 1) return [];
    const questions = resolveWaitingQuestions(pending[0]);
    if (questions?.length !== 1 || questions[0]!.multiSelect) return [];
    return questions[0]!.options?.map((option) => option.label) ?? [];
}
