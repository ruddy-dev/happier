import { describe, expect, it } from 'vitest';
import type { AgentState } from '@/sync/domains/state/storageTypes';
import { resolveCoordinatorReplyChips } from './coordinatorReplyChips';

const question = {
    question: 'Which release?',
    options: [{ label: 'Stable', value: 'stable-id' }, { label: 'Preview', choice: 'preview-id' }],
    multiSelect: false,
};
const request = { tool: 'AskUserQuestion', kind: 'user_action', arguments: { questions: [question] }, createdAt: 1 } as const;

describe('coordinator reply chips', () => {
    it('U: one pending single-select question gives option labels in their original order', () => {
        expect(resolveCoordinatorReplyChips({ question: request })).toEqual(['Stable', 'Preview']);
    });

    it.each<[string, AgentState['requests'] | null]>([
        ['no request map', undefined],
        ['null request map', null],
        ['no requests', {}],
        ['two requests', { first: request, second: request }],
        ['a question alongside a permission request', { first: request, second: { tool: 'Bash', arguments: {}, createdAt: 2 } }],
        ['two questions', { question: { ...request, arguments: { questions: [question, { ...question, question: 'Which version?' }] } } }],
        ['multi select', { question: { ...request, arguments: { questions: [{ ...question, multiSelect: true }] } } }],
        ['unparseable input', { question: { ...request, arguments: { questions: 'unparseable' } } }],
        ['terminal dialog', { question: { ...request, source: 'claude_unified_terminal_dialog_choice' } }],
        ['happierDialog', { question: { ...request, arguments: { ...request.arguments, happierDialog: {} } } }],
        ['permission-kind question', { question: { ...request, kind: 'permission' } }],
    ])('U: %s gives no question chips', (_scenario, requests) => {
        expect(resolveCoordinatorReplyChips(requests)).toEqual([]);
    });
});
