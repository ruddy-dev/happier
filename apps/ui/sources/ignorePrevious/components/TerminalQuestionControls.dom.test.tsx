/** @vitest-environment jsdom */
import * as React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { createSessionFixture, makeToolCall, makeToolViewProps } from '@/dev/testkit';
import { storage } from '@/sync/domains/state/storage';
import { AskUserQuestionView } from '@/components/tools/renderers/workflow/AskUserQuestionView';
import { CoordinatorTranscriptAppearanceProvider } from '../useCoordinatorTranscriptAppearance';
import { deskPrefs } from '../deskPrefs';
import { terminalPalettes } from '../palette';
import { deskMonoFontFamily } from '../fonts/deskFont';
import { t } from '@/text';

// The installed RN Web controls own DOM events, keyboard activation and ARIA mapping.
vi.mock('react-native', async () => vi.importActual('react-native-web'));
vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock();
});
vi.mock('@/components/sessions/terminal/openAttachedSessionTerminal', () => ({
    useOpenAttachedSessionTerminal: () => ({ available: false, unavailableReason: 'missing_machine', open: vi.fn() }),
}));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const tool = makeToolCall({ id: 'dom-question', name: 'AskUserQuestion', state: 'running', input: { questions: [{
    header: 'Release', question: 'Which release?', multiSelect: false,
    options: [{ label: 'Stable', description: 'Use the stable release' }, { label: 'Preview' }],
    freeform: { multiline: true, description: 'Explain your choice' },
}, {
    header: 'Checks', question: 'Which checks?', multiSelect: true,
    options: [{ label: 'Tests' }, { label: 'Types' }],
}] } });

afterEach(() => vi.restoreAllMocks());

it.each(['tokyo', 'terminalPaper', 'mask', 'ordinary'] as const)('exposes actual button selection and preserves editing and focus in %s', async (style) => {
    const sessions = storage.getState().sessions;
    const prefs = { style: deskPrefs.get('chatStyle'), palette: deskPrefs.get('terminalPalette') };
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const find = (id: string) => container.querySelector<HTMLElement>(`[data-testid="${id}"]`)!;
    const option = (q: number, o: number) => find(`ask-user-question.option:${q}:${o}`);
    const paint = style === 'mask' || style === 'ordinary' ? null : terminalPalettes[style];
    const expectTextFont = (text: string) => {
        // Inspect the installed RN Web Text, not a style factory or wrapper. JSDOM's
        // computed style lets RN Web's base `font` shorthand mask inline fontFamily.
        // The lead's real-browser gate checks the computed font and loaded face.
        const node = Array.from(container.querySelectorAll<HTMLElement>('*'))
            .find(element => element.childElementCount === 0 && element.textContent === text);
        expect(node, text).toBeDefined();
        const family = node!.style.fontFamily;
        if (paint) expect.soft(family, text).toBe(deskMonoFontFamily());
        else expect.soft(family, text).not.toBe(deskMonoFontFamily());
    };
    try {
        deskPrefs.set('chatStyle', paint ? 'terminal' : 'mask');
        if (style === 'tokyo' || style === 'terminalPaper') deskPrefs.set('terminalPalette', style);
        const session = createSessionFixture({ id: 'dom-session', agentState: { requests: {
            'dom-question': { tool: 'AskUserQuestion', kind: 'user_action', arguments: tool.input, createdAt: 1 },
        } } });
        storage.setState({ sessions: { ...sessions, 'dom-session': session } });
        const question = <AskUserQuestionView {...makeToolViewProps(tool, { sessionId: 'dom-session' })} />;
        await act(async () => root.render(style === 'ordinary' ? question :
            <CoordinatorTranscriptAppearanceProvider>{question}</CoordinatorTranscriptAppearanceProvider>));
        for (const text of ['Release', 'Which release?', 'Use the stable release', 'Explain your choice']) expectTextFont(text);
        const stable = option(0, 0);
        const controls = () => Array.from(container.querySelectorAll<HTMLElement>('button, textarea, input'))
            .filter(node => node.dataset.testid?.startsWith('ask-user-question.'));
        const expectedOrder = paint
            ? ['option:0:0', 'option:0:1', 'freeform:0', 'option:1:0', 'option:1:1', 'submit']
            : ['freeform:0', 'option:0:0', 'option:0:1', 'option:1:0', 'option:1:1', 'submit'];
        expect.soft(controls().map(node => node.dataset.testid!.replace('ask-user-question.', ''))).toEqual(expectedOrder);
        // No tabindex or CSS order workaround: DOM, accessibility and keyboard traversal agree.
        for (const node of controls().filter(node => !node.hasAttribute('disabled'))) {
            expect(node.tabIndex).toBe(0);
            expect(node.style.order).toBe('');
            await act(async () => node.focus());
            expect(document.activeElement).toBe(node);
        }
        const submit = find('ask-user-question.submit');
        expect(submit.getAttribute('aria-disabled')).toBe('true');

        expect(stable.tagName).toBe('BUTTON');
        expect(stable.getAttribute('aria-pressed')).toBe('false');
        expect(stable.tabIndex).toBe(0);
        await act(async () => stable.focus());
        expect(document.activeElement).toBe(stable);
        if (paint) expect(stable.style.backgroundColor).toBe(paint.ink.startsWith('#') ? toRgb(paint.ink) : paint.ink);
        await act(async () => {
            stable.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
            stable.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }));
            // JSDOM has no button keyboard default action. Deliver its click separately;
            // physical Tab/Enter is the lead-owned authenticated browser gate.
            stable.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));
        });
        expect(stable.getAttribute('aria-pressed')).toBe('true');
        await act(async () => option(0, 1).click());
        expect(stable.getAttribute('aria-pressed')).toBe('false');
        expect(option(0, 1).getAttribute('aria-pressed')).toBe('true');
        await act(async () => option(1, 0).click());
        await act(async () => option(1, 1).click());
        expect(option(1, 0).getAttribute('aria-pressed')).toBe('true');
        expect(option(1, 1).getAttribute('aria-pressed')).toBe('true');
        await act(async () => option(1, 0).click());
        expect(option(1, 0).getAttribute('aria-pressed')).toBe('false');
        expect(option(1, 1).getAttribute('aria-pressed')).toBe('true');
        expect(submit.getAttribute('aria-disabled')).not.toBe('true');
        await act(async () => submit.focus());
        expect(document.activeElement).toBe(submit);
        if (paint) {
            expect(getComputedStyle(submit).backgroundColor).toBe(toRgb(paint.ink));
            expect(getComputedStyle(submit).borderTopLeftRadius).toBe('0px');
        }
        const input = find('ask-user-question.freeform:0') as HTMLTextAreaElement;
        await act(async () => input.focus());
        expect(document.activeElement).toBe(input);
        if (paint) {
            expect(stable.style.backgroundColor).not.toBe(toRgb(paint.ink));
            expect(getComputedStyle(find('ask-user-question.freeform-frame:0')).borderTopWidth).toBe('2px');
        }
        await act(async () => {
            Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, 'literal [answer]\nsecond line');
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        expect(input.value).toBe('literal [answer]\nsecond line');
        expect(option(0, 1).getAttribute('aria-pressed')).toBe('false');
        await act(async () => input.blur());
        if (paint) expect(getComputedStyle(find('ask-user-question.freeform-frame:0')).borderTopWidth).toBe('1px');
        await act(async () => option(1, 1).focus());
        await act(async () => storage.setState({ sessions: { ...sessions, 'dom-session': {
            ...session, agentState: { ...session.agentState, requests: {} },
        } } }));
        expect(input.readOnly).toBe(true);
        expect(option(1, 1).getAttribute('aria-disabled')).toBe('true');
        expect(option(1, 1).getAttribute('aria-pressed')).toBe('true');
        if (paint) expect(getComputedStyle(option(1, 1)).backgroundColor).toBe('rgba(0, 0, 0, 0)');
        await act(async () => option(1, 1).click());
        expect(option(1, 1).getAttribute('aria-pressed')).toBe('true');
        expect(input.value).toBe('literal [answer]\nsecond line');

        if (paint) expectTextFont(t('common.unavailable'));
        const renderQuestion = async (props: Parameters<typeof makeToolViewProps>[1], currentTool = tool) => {
            const view = <AskUserQuestionView {...makeToolViewProps(currentTool, { sessionId: 'dom-session', ...props })} />;
            await act(async () => root.render(style === 'ordinary' ? view :
                <CoordinatorTranscriptAppearanceProvider>{view}</CoordinatorTranscriptAppearanceProvider>));
        };
        await renderQuestion({ interaction: { canSendMessages: true, canApprovePermissions: false, permissionDisabledReason: 'readOnly' } });
        expectTextFont(t('session.sharing.permissionApprovalsDisabledReadOnly'));
        await renderQuestion({}, { ...tool, state: 'completed', result: { answers: {} } });
        for (const text of ['Release:', 'Checks:', 'literal [answer]\nsecond line', 'Types']) expectTextFont(text);
        // A terminal notice is a separate request, not a mutation of this answered form.
        await act(async () => root.render(null));
        await renderQuestion({}, { ...tool, input: { ...tool.input, happierDialog: {
            kind: 'unrecognized', mode: 'notice', dialogId: 'unrecognized_confirmation', action: 'open_terminal',
        } } });
        for (const text of [t('tools.askUserQuestion.claudeDialogNotice.header'), t('tools.askUserQuestion.claudeDialogNotice.question'),
            t('terminalEmbedded.errors.missingMachineTarget')]) expectTextFont(text);
    } finally {
        await act(async () => root.unmount());
        container.remove();
        storage.setState({ sessions });
        deskPrefs.set('chatStyle', prefs.style);
        deskPrefs.set('terminalPalette', prefs.palette);
    }
});

function toRgb(color: string) {
    const element = document.createElement('div');
    element.style.color = color;
    return element.style.color;
}
