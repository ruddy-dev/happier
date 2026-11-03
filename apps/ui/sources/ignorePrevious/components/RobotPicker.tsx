import * as React from 'react';
import { Platform, Pressable, View } from 'react-native';
import { t } from '@/text';
import { useDeskPref } from '../deskPrefs';
import { codexRobotSprites, type SpriteKind } from '../sprites';
import { terminalPalettes, useDeskPaint } from '../palette';
import { DeskText } from '../typography/DeskText';
import { WorkerSprite } from './WorkerSprite';

const unassignedChoices = ['droid', 'ipb'] as const;
const codexChoices = ['model', 'prompt', 'loupe', 'lab'] as const;
const captions = {
    droid: 'captionDroid', ipb: 'captionIpb', model: 'captionModel',
    prompt: 'captionPrompt', loupe: 'captionLoupe', lab: 'captionLab',
} as const;
type Choice = keyof typeof captions;

function choiceLabel(choice: Choice) {
    return t(`ignorePrevious.robots.${choice}`);
}

function choiceCaption(choice: Choice) {
    return t(`ignorePrevious.robots.${captions[choice]}`);
}

function sprites(choice: Choice): readonly SpriteKind[] {
    if (choice === 'model') return [codexRobotSprites.loupe, codexRobotSprites.prompt, codexRobotSprites.lab];
    if (choice === 'droid') return ['ipdroid'];
    if (choice === 'ipb') return ['ipb'];
    return [codexRobotSprites[choice]];
}

function PickerRow<C extends Choice>({ role, choices, selected, onSelect }: {
    role: 'unassigned' | 'codex'; choices: readonly C[]; selected: C; onSelect: (value: C) => void;
}) {
    const desk = useDeskPaint();
    const [chatStyle] = useDeskPref('chatStyle');
    const [terminalPalette] = useDeskPref('terminalPalette');
    const terminal = chatStyle === 'terminal';
    const paint = terminal ? terminalPalettes[terminalPalette] : desk.paint;
    const [focused, setFocused] = React.useState<C | null>(null);
    const refs = React.useRef(new Map<C, View>());
    const optionId = (choice: C) => role === 'unassigned' ? `ip-no-worker-${choice}` : `ip-codex-robot-${choice}`;
    const keyDown = (event: React.KeyboardEvent<HTMLElement>, index: number) => {
        let next = index;
        switch (event.key) {
            case 'ArrowRight': case 'ArrowDown': next = (index + 1) % choices.length; break;
            case 'ArrowLeft': case 'ArrowUp': next = (index + choices.length - 1) % choices.length; break;
            case 'Home': next = 0; break;
            case 'End': next = choices.length - 1; break;
            case ' ': break;
            // React Native Web owns Enter activation; its radio role does not activate Space.
            default: return;
        }
        event.preventDefault();
        event.stopPropagation();
        const choice = choices[next];
        onSelect(choice);
        refs.current.get(choice)?.focus();
    };
    return <View testID={`ip-robot-picker-${role}`} style={{ gap: 8, padding: 8, backgroundColor: paint.panel, borderRadius: terminal ? 0 : 12 }}>
        <DeskText style={{ color: paint.ink }}>{t(`ignorePrevious.robots.${role}`)}</DeskText>
        <View accessibilityRole="radiogroup" accessibilityLabel={t(`ignorePrevious.robots.${role}`)}
            style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {choices.map((choice, index) => {
                const checked = selected === choice;
                return <Pressable key={choice} testID={optionId(choice)}
                    ref={node => { if (node) refs.current.set(choice, node); else refs.current.delete(choice); }}
                    accessibilityRole="radio" accessibilityLabel={choiceLabel(choice)}
                    accessibilityState={{ checked }} onPress={() => onSelect(choice)}
                    onFocus={() => setFocused(choice)} onBlur={() => setFocused(null)}
                    {...(Platform.OS === 'web' ? { 'aria-checked': checked, onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => keyDown(event, index), tabIndex: checked ? 0 : -1 } : {})}
                    style={{ minWidth: 48, minHeight: 48, padding: 2,
                        // Reserve a separate, dashed outer ring. Focus never changes the selected border or moves its artwork.
                        borderWidth: 2, borderStyle: 'dashed', borderColor: focused === choice ? paint.hl : 'transparent', borderRadius: terminal ? 0 : 14 }}>
                    <View style={{ flex: 1, padding: 6, alignItems: 'center', justifyContent: 'center', gap: 4,
                        borderWidth: 1, borderColor: checked ? paint.ink : paint.edge, borderRadius: terminal ? 0 : 10,
                        backgroundColor: checked ? paint.panel2 : paint.bg }}>
                        <View style={{ flexDirection: 'row' }}>
                            {sprites(choice).map(kind => <WorkerSprite key={kind} kind={kind} size={32} paint={paint} bulb="idle" faceStyle="A" preview calm />)}
                        </View>
                        <DeskText style={{ color: paint.ink }}>
                            {terminal ? t(checked ? 'ignorePrevious.robots.selectedTerminal' : 'ignorePrevious.robots.unselectedTerminal') : checked ? t('ignorePrevious.robots.selected') : ''}
                            {' '}{choiceLabel(choice)}
                        </DeskText>
                    </View>
                </Pressable>;
            })}
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
            <View testID={`ip-robot-preview-${role}`} style={{ flexDirection: 'row', gap: 8, flexShrink: 0 }}>
                {sprites(selected).map(kind => <WorkerSprite key={kind} kind={kind} size={48} paint={paint} bulb="idle" faceStyle="A" preview calm />)}
            </View>
            <DeskText testID={`ip-robot-caption-${role}`} style={{ flexGrow: 1, flexShrink: 1, flexBasis: 200, minWidth: 0, color: paint.mute }}>
                {choiceCaption(selected)}
            </DeskText>
        </View>
    </View>;
}

/** The same local, validated preferences power Settings, live workers and the signed-out fixture. */
export function RobotPicker() {
    const [unassigned, setUnassigned] = useDeskPref('noWorkerRobot');
    const [codex, setCodex] = useDeskPref('codexRobot');
    return <View style={{ gap: 16 }}>
        <PickerRow role="unassigned" choices={unassignedChoices} selected={unassigned} onSelect={setUnassigned} />
        <PickerRow role="codex" choices={codexChoices} selected={codex} onSelect={setCodex} />
    </View>;
}
