import * as React from 'react';
import { TranscriptAppearanceContext, type TranscriptQuestionColors } from '@/components/sessions/transcript/TranscriptAppearanceContext';
import { DeskQuestionCard } from '@/ignorePrevious/components/DeskQuestionCard';
import { QuestionControlBracket, QuestionOptionButton, terminalQuestionControlStyles } from '@/ignorePrevious/components/TerminalQuestionControls';
import { View, TouchableOpacity, type GestureResponderEvent } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { ToolViewProps } from '../core/_registry';
import { resolvePermissionRequestId } from '../core/resolvePermissionRequestId';
import { ToolSectionView } from '../../shell/presentation/ToolSectionView';
import { createPermissionActionDispatchGuard } from '../../shell/permissions/permissionActionDispatchGuard';
import { usePendingRequestActionability, pendingRequestFromTool } from '@/components/tools/shell/permissions/usePendingRequestActionability';
import { sessionAllowWithAnswers } from '@/sync/ops';
import { storage, useSession, useSettingMutable } from '@/sync/domains/state/storage';
import { Modal } from '@/modal';
import { t } from '@/text';
import { Text, TextInput } from '@/components/ui/text/Text';
import { resolveAgentRequestKind } from '@/utils/sessions/permissions/permissionPromptPolicy';
import { ActivitySpinner } from '@/components/ui/feedback/ActivitySpinner';
import {
    hasClaudeUnifiedOpenTerminalSecondaryAction,
    isClaudeUnifiedOpenTerminalNotice,
    resolveClaudeUnifiedDialogQuestionPresentation,
} from './resolveClaudeUnifiedDialogQuestionPresentation';
import {
    useOpenAttachedSessionTerminal,
    type AttachedSessionTerminalUnavailableReason,
} from '@/components/sessions/terminal/openAttachedSessionTerminal';
import { isClaudeUnifiedTerminalDialogChoiceAgentStateRequest } from '@happier-dev/agents';
import { getStructuredQuestionAnswersV1Supported } from '@/sync/domains/state/agentStateCapabilities';
import { Icon } from '@/components/ui/icons/Icon';
import {
    areAskUserQuestionsAnswered,
    buildAskUserQuestionAnswerPayload,
    tryBuildAskUserQuestionAnswerPayload,
} from './buildAskUserQuestionAnswerPayload';
import {
    PUBLIC_RPC_HANDLER_ERROR_CODES,
    RPC_ERROR_CODES,
    readRpcErrorCode,
} from '@happier-dev/protocol';


interface QuestionOption {
    value?: string;
    choice?: string;
    label: string;
    description: string;
    settingMutation?: unknown;
}

interface Question {
    responseKey?: string;
    question: string;
    header: string;
    options: QuestionOption[];
    multiSelect: boolean;
    freeform?: {
        placeholder?: string;
        description?: string;
        initialValue?: string;
        multiline?: boolean;
        allowEmpty?: boolean;
    };
}

interface AskUserQuestionInput {
    questions: Question[];
    happierDialog?: unknown;
}

type SubmissionFailureGuidance = 'update' | 'reconnect' | 'retry';

function resolveSubmissionFailureGuidance(error: unknown): SubmissionFailureGuidance | null {
    switch (readRpcErrorCode(error)) {
        case RPC_ERROR_CODES.METHOD_NOT_AVAILABLE:
        case RPC_ERROR_CODES.METHOD_NOT_FOUND:
            return 'update';
        case PUBLIC_RPC_HANDLER_ERROR_CODES.STRUCTURED_QUESTION_RECEIVER_NOT_OWNER:
            return 'reconnect';
        case PUBLIC_RPC_HANDLER_ERROR_CODES.STRUCTURED_QUESTION_INVALID:
        case PUBLIC_RPC_HANDLER_ERROR_CODES.STRUCTURED_QUESTION_LEGACY_INVALID:
        case PUBLIC_RPC_HANDLER_ERROR_CODES.STRUCTURED_QUESTION_LEGACY_AMBIGUOUS:
            return 'retry';
        default:
            return null;
    }
}

function resolveAttachedTerminalUnavailableMessage(
    reason: AttachedSessionTerminalUnavailableReason | null,
): string | null {
    switch (reason) {
        case 'missing_machine':
            return t('terminalEmbedded.errors.missingMachineTarget');
        case 'terminal_disabled':
            return t('terminalEmbedded.errors.disabled');
        case 'cli_update_required':
            return t('deps.ui.notAvailableUpdateCli');
        default:
            return null;
    }
}

function parseAskUserQuestionAnswersFromToolResult(result: unknown): Record<string, string> | null {
    if (typeof result === 'string') {
        try {
            result = JSON.parse(result) as unknown;
        } catch {
            return null;
        }
    }
    if (!result || typeof result !== 'object') return null;
    const maybeAnswers = (result as { answers?: unknown }).answers;
    if (!maybeAnswers || typeof maybeAnswers !== 'object' || Array.isArray(maybeAnswers)) return null;

    const answers: Record<string, string> = {};
    for (const [key, value] of Object.entries(maybeAnswers as Record<string, unknown>)) {
        if (typeof value === 'string') {
            answers[key] = value;
        } else if (Array.isArray(value) && value.every((entry) => typeof entry === 'string')) {
            answers[key] = value.join(', ');
        }
    }
    return answers;
}

function keepFreeformTouchInsideInput(event: GestureResponderEvent): void {
    event.stopPropagation();
}

// Styles MUST be defined outside the component to prevent infinite re-renders
// with react-native-unistyles. The theme is passed as a function parameter.
const defaultStyles = StyleSheet.create((theme) => ({
    container: {
        gap: 16,
    },
    questionSection: {
        gap: 8,
    },
    headerChip: {
        alignSelf: 'flex-start',
        backgroundColor: theme.colors.surface.elevated,
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 4,
        marginBottom: 4,
    },
    headerText: {
        fontSize: 12,
        fontWeight: '600',
        color: theme.colors.text.secondary,
        textTransform: 'uppercase',
    },
    questionText: {
        fontSize: 15,
        fontWeight: '500',
        color: theme.colors.text.primary,
        marginBottom: 8,
    },
    optionsContainer: {
        gap: 4,
    },
    optionButton: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        paddingVertical: 12,
        paddingHorizontal: 12,
        borderRadius: 8,
        backgroundColor: 'transparent',
        borderWidth: 1,
        borderColor: theme.colors.border.default,
        gap: 10,
        minHeight: 44, // Minimum touch target for mobile
    },
    optionButtonSelected: {
        backgroundColor: theme.colors.surface.inset,
        borderColor: theme.colors.radio.active,
    },
    optionButtonDisabled: {
        opacity: 0.6,
    },
    radioOuter: {
        width: 20,
        height: 20,
        borderRadius: 10,
        borderWidth: 2,
        borderColor: theme.colors.text.secondary,
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: 2,
    },
    radioOuterSelected: {
        borderColor: theme.colors.radio.active,
    },
    radioInner: {
        width: 10,
        height: 10,
        borderRadius: 5,
        backgroundColor: theme.colors.radio.dot,
    },
    checkboxOuter: {
        width: 20,
        height: 20,
        borderRadius: 4,
        borderWidth: 2,
        borderColor: theme.colors.text.secondary,
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: 2,
    },
    checkboxOuterSelected: {
        borderColor: theme.colors.radio.active,
        backgroundColor: theme.colors.radio.active,
    },
    optionContent: {
        flex: 1,
    },
    optionLabel: {
        fontSize: 14,
        fontWeight: '500',
        color: theme.colors.text.primary,
    },
    optionDescription: {
        fontSize: 13,
        color: theme.colors.text.secondary,
        marginTop: 2,
    },
    freeformInput: {
        borderWidth: 1,
        borderColor: theme.colors.border.default,
        borderRadius: 8,
        paddingHorizontal: 12,
        paddingVertical: 12,
        fontSize: 14,
        color: theme.colors.text.primary,
        backgroundColor: theme.colors.surface.base,
        minHeight: 44,
    },
    freeformDescription: {
        fontSize: 13,
        color: theme.colors.text.secondary,
        marginTop: 6,
        marginLeft: 2,
    },
    actionsContainer: {
        flexDirection: 'row',
        gap: 12,
        marginTop: 8,
        justifyContent: 'flex-end',
    },
    submitButton: {
        backgroundColor: theme.colors.button.primary.background,
        paddingHorizontal: 20,
        paddingVertical: 12,
        borderRadius: 8,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        minHeight: 44, // Minimum touch target for mobile
    },
    submitButtonDisabled: {
        opacity: 0.5,
    },
    submitButtonText: {
        color: theme.colors.button.primary.tint,
        fontSize: 14,
        fontWeight: '600',
    },
    submittedContainer: {
        gap: 8,
    },
    submittedItem: {
        flexDirection: 'row',
        gap: 8,
    },
    submittedHeader: {
        fontSize: 13,
        fontWeight: '600',
        color: theme.colors.text.secondary,
    },
    submittedValue: {
        fontSize: 13,
        color: theme.colors.text.primary,
        flex: 1,
    },
}));

// Only the real question consumes these colors. Keep the ordinary Unistyles path intact.
function scopedQuestionStyles(colors: TranscriptQuestionColors) {
    return {
        ...defaultStyles,
        headerChip: [defaultStyles.headerChip, { backgroundColor: colors.surface }],
        headerText: [defaultStyles.headerText, { color: colors.secondary }],
        questionText: [defaultStyles.questionText, { color: colors.text }],
        optionButton: [defaultStyles.optionButton, { borderColor: colors.border }],
        optionButtonSelected: [defaultStyles.optionButtonSelected, { backgroundColor: colors.surface, borderColor: colors.accent }],
        // Observer and fixture text stays readable; canInteract still owns every control.
        optionButtonDisabled: { opacity: 1 },
        radioOuter: [defaultStyles.radioOuter, { borderColor: colors.secondary }],
        radioOuterSelected: [defaultStyles.radioOuterSelected, { borderColor: colors.accent }],
        radioInner: [defaultStyles.radioInner, { backgroundColor: colors.accent }],
        checkboxOuter: [defaultStyles.checkboxOuter, { borderColor: colors.secondary }],
        checkboxOuterSelected: [defaultStyles.checkboxOuterSelected, { borderColor: colors.accent, backgroundColor: colors.accent }],
        optionLabel: [defaultStyles.optionLabel, { color: colors.text }],
        optionDescription: [defaultStyles.optionDescription, { color: colors.secondary }],
        freeformInput: [defaultStyles.freeformInput, { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border }],
        freeformDescription: [defaultStyles.freeformDescription, { color: colors.secondary }],
        submitButton: [defaultStyles.submitButton, { backgroundColor: colors.button }],
        submitButtonText: [defaultStyles.submitButtonText, { color: colors.buttonText }],
        submittedHeader: [defaultStyles.submittedHeader, { color: colors.secondary }],
        submittedValue: [defaultStyles.submittedValue, { color: colors.text }],
    };
}

function QuestionChrome({ enabled, active, actionable, contextText, children }: { enabled: boolean; active: boolean; actionable: boolean; contextText: readonly string[]; children: React.ReactNode }) {
    return enabled ? <DeskQuestionCard active={active} actionable={actionable} contextText={contextText}>{children}</DeskQuestionCard> : <>{children}</>;
}

export const AskUserQuestionView = React.memo<ToolViewProps>(({ tool, permissionRequest, sessionId, interaction }) => {
    const { theme } = useUnistyles();
    const appearance = React.useContext(TranscriptAppearanceContext);
    const colors = appearance?.questionColors;
    const styles = React.useMemo(() => colors ? scopedQuestionStyles(colors) : defaultStyles, [theme, colors]);
    const controlStyles = React.useMemo(() => colors ? terminalQuestionControlStyles(colors) : null, [colors]);
    const [focusedControl, setFocusedControl] = React.useState<string | null>(null);
    const [selections, setSelections] = React.useState<Map<number, Set<number>>>(new Map());
    const [freeformAnswers, setFreeformAnswers] = React.useState<Map<number, string>>(new Map());
    const [isSubmitting, setIsSubmitting] = React.useState(false);
    const [isSubmitted, setIsSubmitted] = React.useState(false);
    const [submissionGuidance, setSubmissionGuidance] = React.useState<SubmissionFailureGuidance | null>(null);
    const [, setWorkspaceTrust] = useSettingMutable('claudeUnifiedTerminalWorkspaceTrust');
    const [, setResumeChoice] = useSettingMutable('claudeUnifiedTerminalResumeChoice');
    const attachedSessionTerminal = useOpenAttachedSessionTerminal(sessionId ?? null);
    const session = useSession(sessionId ?? '');

    const toolCallId = resolvePermissionRequestId(tool);
    const activeMatchingRequest = toolCallId ? session?.agentState?.requests?.[toolCallId] : null;
    const hasActiveAskUserQuestionRequest =
        activeMatchingRequest?.tool === 'AskUserQuestion' &&
        resolveAgentRequestKind({ toolName: activeMatchingRequest.tool, requestKind: activeMatchingRequest.kind }) === 'user_action';
    const requestKey = `${sessionId}\u0000${toolCallId}`;
    const actionDispatchGuardRef = React.useRef<ReturnType<typeof createPermissionActionDispatchGuard> | null>(null);
    if (actionDispatchGuardRef.current === null) {
        actionDispatchGuardRef.current = createPermissionActionDispatchGuard(requestKey);
    } else {
        actionDispatchGuardRef.current.setRequestKey(requestKey);
    }
    const actionDispatchGuard = actionDispatchGuardRef.current;
    React.useEffect(() => {
        if (!sessionId || !toolCallId || !hasActiveAskUserQuestionRequest) return;
        actionDispatchGuard.retainRequest(requestKey);
        return () => actionDispatchGuard.releaseRequest(requestKey);
    }, [actionDispatchGuard, hasActiveAskUserQuestionRequest, requestKey, sessionId, toolCallId]);

    // Parse input
    const input = tool.input as AskUserQuestionInput | undefined;
    const questions = input
        ? resolveClaudeUnifiedDialogQuestionPresentation(input, (key) => t(key)).questions as Question[]
        : undefined;

    if (!questions || !Array.isArray(questions) || questions.length === 0) {
        return null;
    }

    const contextText = questions.flatMap(q => [q.header, q.question].filter((v): v is string => typeof v === 'string'));
    const effectiveFreeformAnswers = new Map<number, string>();
    questions.forEach((question, questionIndex) => {
        if (freeformAnswers.has(questionIndex)) {
            effectiveFreeformAnswers.set(questionIndex, freeformAnswers.get(questionIndex) ?? '');
        } else if (typeof question.freeform?.initialValue === 'string') {
            effectiveFreeformAnswers.set(questionIndex, question.freeform.initialValue);
        }
    });

    const isRunning = tool.state === 'running';
    const canApprovePermissions = interaction?.canApprovePermissions ?? true;
    const { actionable, isActionable } = usePendingRequestActionability(sessionId, permissionRequest ?? pendingRequestFromTool(tool));
    const canInteract = actionable && isRunning && !isSubmitted && canApprovePermissions && hasActiveAskUserQuestionRequest;
    const disabledMessage =
        interaction?.permissionDisabledReason === 'public'
            ? t('session.sharing.permissionApprovalsDisabledPublic')
            : interaction?.permissionDisabledReason === 'readOnly'
                ? t('session.sharing.permissionApprovalsDisabledReadOnly')
                : t('session.sharing.permissionApprovalsDisabledNotGranted');
    const isAttachedTerminalNotice = isClaudeUnifiedOpenTerminalNotice(input?.happierDialog);
    const hasAttachedTerminalSecondaryAction = hasClaudeUnifiedOpenTerminalSecondaryAction(input?.happierDialog);
    const canOpenAttachedTerminal = Boolean(
        sessionId
        && isRunning
        && canApprovePermissions
        && attachedSessionTerminal.available,
    );
    const attachedTerminalUnavailableMessage = resolveAttachedTerminalUnavailableMessage(
        attachedSessionTerminal.unavailableReason,
    );

    if (isAttachedTerminalNotice && tool.state !== 'completed') {
        const question = questions[0];
        return (
            <ToolSectionView>
                <View testID="ask-user-question" style={styles.container}>
                    <View style={styles.questionSection}>
                        <View style={styles.headerChip}>
                            <Text style={styles.headerText}>{question?.header}</Text>
                        </View>
                        <Text style={styles.questionText}>{question?.question}</Text>
                        {canOpenAttachedTerminal ? (
                            <TouchableOpacity
                                testID="ask-user-question.open-claude-terminal"
                                accessibilityRole="button"
                                accessibilityLabel={t('tools.askUserQuestion.claudeDialogNotice.openTerminal')}
                                style={styles.optionButton}
                                onPress={attachedSessionTerminal.open}
                                activeOpacity={0.7}
                            >
                                <Icon name="terminal" size={20} color={colors?.secondary ?? theme.colors.text.secondary} />
                                <View style={styles.optionContent}>
                                    <Text style={styles.optionLabel}>{t('tools.askUserQuestion.claudeDialogNotice.openTerminal')}</Text>
                                    <Text style={styles.optionDescription}>{t('tools.askUserQuestion.claudeDialogNotice.description')}</Text>
                                </View>
                            </TouchableOpacity>
                        ) : !canApprovePermissions ? (
                            <Text style={styles.optionDescription}>{disabledMessage}</Text>
                        ) : isRunning && attachedTerminalUnavailableMessage ? (
                            <Text
                                testID="ask-user-question.attached-terminal-unavailable"
                                style={styles.optionDescription}
                            >
                                {attachedTerminalUnavailableMessage}
                            </Text>
                        ) : null}
                    </View>
                </View>
            </ToolSectionView>
        );
    }

    const allQuestionsAnswered = areAskUserQuestionsAnswered({
        questions, selections, freeformAnswers: effectiveFreeformAnswers,
    });
    const prospectivePayload = allQuestionsAnswered
        ? tryBuildAskUserQuestionAnswerPayload({
            questions,
            selections,
            freeformAnswers: effectiveFreeformAnswers,
            structuredQuestionAnswersV1Supported: getStructuredQuestionAnswersV1Supported(
                session?.agentState?.capabilities,
            ),
        })
        : null;
    const requiresCliUpdate = prospectivePayload?.ok === true
        && prospectivePayload.payload.kind === 'requires_cli_update';
    const canSubmit = allQuestionsAnswered
        && prospectivePayload?.ok === true
        && prospectivePayload.payload.kind !== 'requires_cli_update';

    const handleOptionToggle = React.useCallback((questionIndex: number, optionIndex: number, multiSelect: boolean) => {
        if (!canInteract) return;

        setSelections(prev => {
            const newMap = new Map(prev);
            const currentSet = newMap.get(questionIndex) || new Set();

            if (multiSelect) {
                // Toggle for multi-select
                const newSet = new Set(currentSet);
                if (newSet.has(optionIndex)) {
                    newSet.delete(optionIndex);
                } else {
                    newSet.add(optionIndex);
                }
                newMap.set(questionIndex, newSet);
            } else {
                // Replace for single-select
                newMap.set(questionIndex, new Set([optionIndex]));
            }

            return newMap;
        });
        setSubmissionGuidance(null);

        // If the user chooses a structured option, clear any typed freeform value so we have a single source of truth.
        setFreeformAnswers((prev) => {
            if (!prev.has(questionIndex) && questions[questionIndex]?.freeform?.initialValue === undefined) return prev;
            const next = new Map(prev);
            next.set(questionIndex, '');
            return next;
        });
    }, [canInteract, questions]);

    const handleSubmit = React.useCallback(async () => {
        if (!sessionId || !canApprovePermissions || !allQuestionsAnswered || isSubmitting || !isActionable()) return;

        // Format answers as readable text
        const responseLines: string[] = [];
        questions.forEach((q, qIndex) => {
            const options = Array.isArray(q.options) ? q.options : [];
            const typed = effectiveFreeformAnswers.get(qIndex);
            const typedText = typeof typed === 'string' ? typed.trim() : '';
            if (options.length === 0) {
                if (typedText.length > 0) {
                    responseLines.push(`${q.header}: ${typedText}`);
                }
                return;
            }

            const selected = selections.get(qIndex);
            if (typedText.length > 0) {
                responseLines.push(`${q.header}: ${typedText}`);
                return;
            }
            if (selected && selected.size > 0) {
                const selectedLabelsArray = Array.from(selected)
                    .map(optIndex => options[optIndex]?.label)
                    .filter(Boolean);
                const selectedLabelsText = selectedLabelsArray.join(', ');
                responseLines.push(`${q.header}: ${selectedLabelsText}`);
            }
        });

        const responseText = responseLines.join('\n');

        try {
            if (!toolCallId) {
                Modal.alert(t('common.error'), t('errors.missingPermissionId'));
                return;
            }

            const latestSession = storage.getState().sessions[sessionId];
            const latestRequest = (latestSession as any)?.agentState?.requests?.[toolCallId];
            const hasLiveMatchingRequest =
                latestRequest?.tool === 'AskUserQuestion' &&
                resolveAgentRequestKind({ toolName: latestRequest.tool, requestKind: latestRequest.kind }) === 'user_action';
            if (!hasLiveMatchingRequest) {
                return;
            }

            const payload = buildAskUserQuestionAnswerPayload({
                questions,
                selections,
                freeformAnswers: effectiveFreeformAnswers,
                structuredQuestionAnswersV1Supported: getStructuredQuestionAnswersV1Supported(
                    latestSession?.agentState?.capabilities,
                ),
            });
            if (payload.kind === 'requires_cli_update') {
                Modal.alert(t('common.error'), t('deps.ui.notAvailableUpdateCli'));
                return;
            }

            await actionDispatchGuard.dispatch(requestKey, async () => {
                try {
                    setIsSubmitting(true);
                    setSubmissionGuidance(null);

                    // HACK: Disable the form immediately by switching to the submitted view.
                    // Without this, users could edit their selections while the network calls
                    // are in flight, but those edits would be ignored since we've already
                    // captured the values above. TODO: Revisit this logic.
                    setIsSubmitted(true);

                    await sessionAllowWithAnswers(sessionId, toolCallId, payload.send);
                    const dialog = input?.happierDialog;
                    if (dialog && typeof dialog === 'object' && !Array.isArray(dialog)) {
                        const metadata = dialog as Record<string, unknown>;
                        if (isClaudeUnifiedTerminalDialogChoiceAgentStateRequest(latestRequest) && metadata.kind === 'recognized') {
                            for (const [questionIndex, selectedIndexes] of selections) {
                                for (const optionIndex of selectedIndexes) {
                                    const mutation = questions[questionIndex]?.options?.[optionIndex]?.settingMutation;
                                    if (!mutation || typeof mutation !== 'object' || Array.isArray(mutation)) continue;
                                    const candidate = mutation as Record<string, unknown>;
                                    if (
                                        metadata.dialogId === 'trust_folder'
                                        && candidate.settingId === 'claudeUnifiedTerminalWorkspaceTrust'
                                        && (
                                            candidate.value === 'always_trust_happier_workspaces'
                                            || candidate.value === 'always_reject_happier_workspaces'
                                        )
                                    ) {
                                        setWorkspaceTrust(candidate.value);
                                    } else if (
                                        metadata.dialogId === 'resume_choice'
                                        && candidate.settingId === 'claudeUnifiedTerminalResumeChoice'
                                        && (
                                            candidate.value === 'resume_from_summary'
                                            || candidate.value === 'resume_full_session'
                                        )
                                    ) {
                                        setResumeChoice(candidate.value);
                                    }
                                }
                            }
                        }
                    }
                } finally {
                    setIsSubmitting(false);
                }
            });
        } catch (error) {
            setIsSubmitted(false);
            const guidance = resolveSubmissionFailureGuidance(error);
            if (guidance) {
                setSubmissionGuidance(guidance);
            } else {
                Modal.alert(t('common.error'), t('errors.failedToSendMessage'));
            }
        }
    }, [actionDispatchGuard, requestKey, sessionId, isActionable, canApprovePermissions, questions, selections, effectiveFreeformAnswers, allQuestionsAnswered, input?.happierDialog, isSubmitting, setResumeChoice, setWorkspaceTrust, toolCallId]);

    // Show submitted state
    if (isSubmitted || tool.state === 'completed') {
        const answersFromResult = parseAskUserQuestionAnswersFromToolResult(tool.result);
        return (
            <QuestionChrome enabled={appearance !== null} active={false} actionable={false} contextText={contextText}>
            <ToolSectionView>
                <View style={styles.submittedContainer}>
                    {questions.map((q, qIndex) => {
                        const selected = selections.get(qIndex);
                        const questionKey = typeof q.question === 'string' && q.question.trim().length > 0 ? q.question : q.header;
                        const options = Array.isArray(q.options) ? q.options : [];
                        const freeform = effectiveFreeformAnswers.get(qIndex);
                        const selectedLabels =
                            options.length === 0
                                ? ((typeof freeform === 'string' && freeform.trim().length > 0)
                                    ? freeform.trim()
                                    : (answersFromResult?.[questionKey] ?? '-'))
                                : ((typeof freeform === 'string' && freeform.trim().length > 0)
                                    ? freeform.trim()
                                    : (selected && selected.size > 0
                                        ? Array.from(selected)
                                            .map(optIndex => options[optIndex]?.label)
                                            .filter(Boolean)
                                            .join(', ')
                                        : (answersFromResult?.[questionKey] ?? '-')));
                        return (
                            <View key={qIndex} style={styles.submittedItem}>
                                <Text style={styles.submittedHeader}>{q.header}:</Text>
                                <Text style={styles.submittedValue}>{selectedLabels}</Text>
                            </View>
                        );
                    })}
                </View>
            </ToolSectionView>
            </QuestionChrome>
        );
    }

    return (
        <QuestionChrome enabled={appearance !== null} active={isRunning} actionable={canInteract} contextText={contextText}>
        <ToolSectionView>
            <View testID="ask-user-question" style={styles.container}>
                {!canApprovePermissions && isRunning ? (
                    <Text style={{ color: colors?.secondary ?? theme.colors.text.secondary }}>
                        {disabledMessage}
                    </Text>
                ) : null}
                {hasAttachedTerminalSecondaryAction && canOpenAttachedTerminal ? (
                    <TouchableOpacity
                        testID="ask-user-question.open-claude-terminal"
                        accessibilityRole="button"
                        accessibilityLabel={t('tools.askUserQuestion.claudeDialogNotice.openTerminal')}
                        style={styles.optionButton}
                        onPress={attachedSessionTerminal.open}
                        activeOpacity={0.7}
                    >
                        <Icon name="terminal" size={20} color={colors?.secondary ?? theme.colors.text.secondary} />
                        <View style={styles.optionContent}>
                            <Text style={styles.optionLabel}>{t('tools.askUserQuestion.claudeDialogNotice.openTerminal')}</Text>
                            <Text style={styles.optionDescription}>{t('tools.askUserQuestion.claudeDialogNotice.description')}</Text>
                        </View>
                    </TouchableOpacity>
                ) : hasAttachedTerminalSecondaryAction && isRunning && canApprovePermissions && attachedTerminalUnavailableMessage ? (
                    <Text
                        testID="ask-user-question.attached-terminal-unavailable"
                        style={styles.optionDescription}
                    >
                        {attachedTerminalUnavailableMessage}
                    </Text>
                ) : null}
                {questions.map((question, qIndex) => {
                    const selectedOptions = selections.get(qIndex) || new Set();
                    const options = Array.isArray(question.options) ? question.options : [];

                    return (
                        <View key={qIndex} style={styles.questionSection}>
                            <View style={styles.headerChip}>
                                <Text style={styles.headerText}>{question.header}</Text>
                            </View>
                            <Text style={styles.questionText}>{question.question}</Text>
                            <View style={styles.optionsContainer}>
                                {colors && !canInteract && options.length > 0 ? (
                                    <Text testID={`ask-user-question.options-unavailable:${qIndex}`} style={styles.optionDescription}>
                                        {t('common.unavailable')}
                                    </Text>
                                ) : null}
                                {options.length === 0 || question.freeform ? (
                                    <View>
                                        <View testID={`ask-user-question.freeform-frame:${qIndex}`} style={controlStyles ? [
                                            controlStyles.inputFrame,
                                            canInteract && focusedControl === `input:${qIndex}` && controlStyles.focusedInput,
                                        ] : undefined}>
                                            {controlStyles ? <QuestionControlBracket style={controlStyles.bracket}>{'[ '}</QuestionControlBracket> : null}
                                            <TextInput
                                                testID={`ask-user-question.freeform:${qIndex}`}
                                                style={[styles.freeformInput, controlStyles?.input]}
                                                onFocus={controlStyles ? () => setFocusedControl(`input:${qIndex}`) : undefined}
                                                onBlur={controlStyles ? () => setFocusedControl(null) : undefined}
                                                accessibilityLabel={controlStyles ? question.question : undefined}
                                                value={effectiveFreeformAnswers.get(qIndex) ?? ''}
                                                onTouchStart={keepFreeformTouchInsideInput}
                                                onChangeText={(text) => {
                                                    if (!canInteract) return;
                                                    setFreeformAnswers((prev) => {
                                                        const next = new Map(prev);
                                                        next.set(qIndex, text);
                                                        return next;
                                                    });
                                                    if (options.length > 0 && text.trim().length > 0) {
                                                        setSelections((prev) => {
                                                            if (!prev.has(qIndex)) return prev;
                                                            const next = new Map(prev);
                                                            next.delete(qIndex);
                                                            return next;
                                                        });
                                                    }
                                                }}
                                                placeholder={question.freeform?.placeholder ?? t('tools.askUserQuestion.otherPlaceholder')}
                                                placeholderTextColor={colors?.secondary ?? theme.colors.input.placeholder}
                                                editable={canInteract}
                                                multiline={question.freeform?.multiline === true}
                                                textAlignVertical={question.freeform?.multiline === true ? 'top' : 'center'}
                                                autoCapitalize="none"
                                                autoCorrect={false}
                                            />
                                            {controlStyles ? <QuestionControlBracket style={controlStyles.bracket}>{' ]'}</QuestionControlBracket> : null}
                                        </View>
                                        {question.freeform?.description ? (
                                            <Text style={styles.freeformDescription}>{question.freeform.description}</Text>
                                        ) : null}
                                    </View>
                                ) : null}
                                {options.map((option, oIndex) => {
                                    const isSelected = selectedOptions.has(oIndex);
                                    const testID = `ask-user-question.option:${qIndex}:${oIndex}`;
                                    const focused = canInteract && focusedControl === testID;
                                    const terminalTextStyle = controlStyles ? [
                                        controlStyles.text,
                                        !canInteract && controlStyles.unavailableText,
                                        focused && controlStyles.focusedText,
                                    ] : null;

                                    return (
                                        <QuestionOptionButton
                                            key={oIndex}
                                            terminal={controlStyles != null}
                                            testID={testID}
                                            accessibilityRole="button"
                                            accessibilityLabel={option.label}
                                            accessibilityState={{ selected: isSelected }}
                                            style={[
                                                styles.optionButton,
                                                isSelected && styles.optionButtonSelected,
                                                !canInteract && styles.optionButtonDisabled,
                                                controlStyles?.option,
                                                controlStyles && !canInteract && controlStyles.unavailable,
                                                controlStyles && focused && controlStyles.focusedOption,
                                            ]}
                                            onFocus={controlStyles ? () => setFocusedControl(testID) : undefined}
                                            onBlur={controlStyles ? () => setFocusedControl(null) : undefined}
                                            onPress={() => handleOptionToggle(qIndex, oIndex, question.multiSelect)}
                                            disabled={!canInteract}
                                            activeOpacity={0.7}
                                        >
                                            {controlStyles ? null : question.multiSelect ? (
                                                <View style={[
                                                    styles.checkboxOuter,
                                                    isSelected && styles.checkboxOuterSelected,
                                                ]}>
                                                    {isSelected && (
                                                        <Icon name="check" size={14} color={colors?.onAccent ?? theme.colors.button.primary.tint} />
                                                    )}
                                                </View>
                                            ) : (
                                                <View style={[
                                                    styles.radioOuter,
                                                    isSelected && styles.radioOuterSelected,
                                                ]}>
                                                    {isSelected && <View style={styles.radioInner} />}
                                                </View>
                                            )}
                                            <View style={styles.optionContent}>
                                                <Text style={[styles.optionLabel, terminalTextStyle]}>
                                                    {controlStyles ? <QuestionControlBracket style={[styles.optionLabel, terminalTextStyle]}>{isSelected ? '[✓ ' : '[ '}</QuestionControlBracket> : null}
                                                    {option.label}
                                                    {controlStyles ? <QuestionControlBracket style={[styles.optionLabel, terminalTextStyle]}>{' ]'}</QuestionControlBracket> : null}
                                                </Text>
                                                {option.description && (
                                                    <Text style={[styles.optionDescription, terminalTextStyle]}>{option.description}</Text>
                                                )}
                                            </View>
                                        </QuestionOptionButton>
                                    );
                                })}
                            </View>
                        </View>
                    );
                })}

                {submissionGuidance ? (
                    <Text
                        testID="ask-user-question.submission-guidance"
                        style={styles.optionDescription}
                    >
                        {t(`tools.askUserQuestion.submissionFailures.${submissionGuidance}`)}
                    </Text>
                ) : null}

                {canInteract && (
                    <View style={styles.actionsContainer}>
                        {requiresCliUpdate ? (
                            <Text style={styles.optionDescription}>{t('deps.ui.notAvailableUpdateCli')}</Text>
                        ) : null}
                        <TouchableOpacity
                            testID="ask-user-question.submit"
                            accessibilityRole="button"
                            accessibilityLabel={t('tools.askUserQuestion.submit')}
                            style={[
                                styles.submitButton,
                                (!canSubmit || isSubmitting) && styles.submitButtonDisabled,
                            ]}
                            onPress={handleSubmit}
                            disabled={!canSubmit || isSubmitting}
                            activeOpacity={0.7}
                        >
                            {isSubmitting ? (
                                <ActivitySpinner size="small" color={colors?.buttonText ?? theme.colors.button.primary.tint} />
                            ) : (
                                <Text style={styles.submitButtonText}>{t('tools.askUserQuestion.submit')}</Text>
                            )}
                        </TouchableOpacity>
                    </View>
                )}
            </View>
        </ToolSectionView>
        </QuestionChrome>
    );
});
