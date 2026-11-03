import * as React from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import {
    areAskUserQuestionsAnswered,
    buildAskUserQuestionAnswerPayload,
    tryBuildAskUserQuestionAnswerPayload,
    type AskUserQuestionPayloadQuestion,
} from '@/components/tools/renderers/workflow/buildAskUserQuestionAnswerPayload';
import { getStructuredQuestionAnswersV1Supported } from '@/sync/domains/state/agentStateCapabilities';
import { storage } from '@/sync/domains/state/storage';
import { sessionAllowWithAnswers } from '@/sync/ops';
import { t } from '@/text';
import { DESK_FONT_STACK } from '../fonts/deskFont';
import { DeskText } from '../typography/DeskText';
import { resolveWaitingQuestions } from '../model/waitingQuestions';
import { displayText } from '../model/displayText';

/** A draft only. The enclosing card owns dispatch arbitration, errors and settlement. */
export function WaitingQuestion({ sessionId, requestId, questions, readOnly, disabled, busy, sent, error, onSend, onDirtyChange }: {
    sessionId: string;
    requestId: string;
    questions: ReadonlyArray<AskUserQuestionPayloadQuestion>;
    readOnly: boolean;
    disabled: boolean;
    busy: boolean;
    sent: boolean;
    error: string | null;
    onSend: (call: () => Promise<void>) => void;
    onDirtyChange?: (dirty: boolean) => void;
}) {
    const { theme } = useUnistyles();
    const mounted = React.useRef(true);
    React.useLayoutEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; };
    }, []);
    const capabilities = storage(state => state.sessions[sessionId]?.agentState?.capabilities);
    const [selections, setSelections] = React.useState<ReadonlyMap<number, ReadonlySet<number>>>(() => new Map());
    const [freeformAnswers, setFreeformAnswers] = React.useState<ReadonlyMap<number, string>>(() => new Map());
    const effectiveFreeformAnswers = React.useMemo(() => new Map(questions.map((question, index) => [
        index, freeformAnswers.get(index) ?? question.freeform?.initialValue ?? '',
    ])), [questions, freeformAnswers]);
    const dirty = !readOnly && !sent && ([...selections.values()].some(value => value.size > 0)
        || [...effectiveFreeformAnswers.values()].some(value => value.length > 0));
    React.useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
    React.useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

    const complete = areAskUserQuestionsAnswered({ questions, selections, freeformAnswers: effectiveFreeformAnswers });
    const prospective = complete ? tryBuildAskUserQuestionAnswerPayload({
        questions, selections, freeformAnswers: effectiveFreeformAnswers,
        structuredQuestionAnswersV1Supported: getStructuredQuestionAnswersV1Supported(capabilities),
    }) : null;
    const requiresUpdate = prospective?.ok === true && prospective.payload.kind === 'requires_cli_update';
    const canSend = !readOnly && !disabled && complete && prospective?.ok === true && !requiresUpdate;
    const submit = () => {
        if (!mounted.current || !canSend) return;
        // A store update can precede React's next commit. Never apply this draft to new content.
        const session = storage.getState().sessions[sessionId];
        const currentQuestions = resolveWaitingQuestions(session?.agentState?.requests?.[requestId]);
        if (!currentQuestions || JSON.stringify(currentQuestions) !== JSON.stringify(questions)) return;
        onSend(async () => {
            // Capabilities may have changed since the button rendered; build against the live session.
            const session = storage.getState().sessions[sessionId];
            if (!session?.agentState?.requests?.[requestId]) throw { errorCode: 'permission_request_not_found' };
            const payload = buildAskUserQuestionAnswerPayload({
                questions, selections, freeformAnswers: effectiveFreeformAnswers,
                structuredQuestionAnswersV1Supported: getStructuredQuestionAnswersV1Supported(session.agentState.capabilities),
            });
            if (payload.kind === 'requires_cli_update') throw new Error('requires_cli_update');
            await sessionAllowWithAnswers(sessionId, requestId, payload.send);
        });
    };
    const text = { color: theme.colors.text.primary, fontSize: 14 };
    const secondary = { color: theme.colors.text.secondary, fontSize: 13 };
    const control = {
        minHeight: 48, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1,
        borderRadius: 10, borderColor: theme.colors.border.default, backgroundColor: theme.colors.surface.inset,
    };
    return <View style={{ gap: 12 }}>
        {questions.map((question, index) => <View key={index} style={{ gap: 8 }}>
            {typeof question.header === 'string' ? <DeskText style={secondary}>{displayText(question.header)}</DeskText> : null}
            {typeof question.question === 'string' ? <DeskText selectable style={text}>{displayText(question.question)}</DeskText> : null}
            {(question.options ?? []).map((option, optionIndex) => {
                if (readOnly) return <View key={optionIndex} style={{ gap: 4 }}>
                    <DeskText selectable style={text}>{displayText(option.label)}</DeskText>
                    {option.description ? <DeskText selectable style={secondary}>{displayText(option.description)}</DeskText> : null}
                </View>;
                const selected = selections.get(index)?.has(optionIndex) === true;
                return <Pressable key={optionIndex} testID={`ip-waiting-option-${requestId}-${index}-${optionIndex}`}
                    accessibilityRole="button" accessibilityLabel={displayText(option.label)}
                    accessibilityState={{ selected, disabled }} disabled={disabled}
                    style={[control, selected ? { borderColor: theme.colors.text.primary, backgroundColor: theme.colors.surface.elevated } : null, disabled ? { opacity: 0.5 } : null]}
                    onPress={() => {
                        if (disabled) return;
                        setSelections(current => {
                            const next = new Map(current);
                            const selected = new Set(question.multiSelect ? current.get(index) : []);
                            if (question.multiSelect && selected.has(optionIndex)) selected.delete(optionIndex);
                            else selected.add(optionIndex);
                            next.set(index, selected); return next;
                        });
                        setFreeformAnswers(current => new Map(current).set(index, ''));
                    }}>
                    <DeskText style={text}>{displayText(option.label)}</DeskText>
                    {option.description ? <DeskText style={secondary}>{displayText(option.description)}</DeskText> : null}
                </Pressable>;
            })}
            {question.freeform || !question.options?.length ? <View style={{ gap: 6 }}>
                <DeskText style={secondary}>{t('ignorePrevious.questionCard.other')}</DeskText>
                {readOnly ? (question.freeform?.initialValue ? <DeskText selectable style={text}>{displayText(question.freeform.initialValue)}</DeskText> : null) : <TextInput testID={`ip-waiting-other-${requestId}-${index}`}
                    accessibilityLabel={`${displayText(typeof question.question === 'string' ? question.question : typeof question.header === 'string' ? question.header : '')} — ${t('ignorePrevious.questionCard.other')}`}
                    value={effectiveFreeformAnswers.get(index) ?? ''} editable={!disabled}
                    multiline={question.freeform?.multiline === true}
                    autoCapitalize="none" autoCorrect={false}
                    placeholder={question.freeform?.placeholder ? displayText(question.freeform.placeholder) : t('ignorePrevious.questionCard.otherPlaceholder')}
                    placeholderTextColor={theme.colors.input.placeholder}
                    style={[control, text, { fontFamily: DESK_FONT_STACK }]}
                    onChangeText={value => {
                        if (disabled) return;
                        setFreeformAnswers(current => new Map(current).set(index, value));
                        if (value.trim().length > 0) setSelections(current => {
                            const next = new Map(current); next.delete(index); return next;
                        });
                    }} />}
                {question.freeform?.description ? <DeskText style={secondary}>{displayText(question.freeform.description)}</DeskText> : null}
            </View> : null}
        </View>)}
        {requiresUpdate ? <DeskText style={secondary}>{t('deps.ui.notAvailableUpdateCli')}</DeskText> : null}
        {error ? <DeskText testID={`ip-waiting-question-error-${requestId}`} accessibilityRole="alert" style={secondary}>{error}</DeskText> : null}
        {readOnly ? null : <Pressable testID={`ip-waiting-send-${requestId}`} accessibilityRole="button"
            accessibilityLabel={t('ignorePrevious.questionCard.send')} accessibilityState={{ disabled: !canSend, busy }}
            aria-busy={busy}
            disabled={!canSend} onPress={submit} style={[control, !canSend ? { opacity: 0.5 } : null]}>
            <DeskText style={text}>{t('ignorePrevious.questionCard.send')}</DeskText>
        </Pressable>}
    </View>;
}
