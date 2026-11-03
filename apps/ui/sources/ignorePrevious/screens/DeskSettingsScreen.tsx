import * as React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useUnistyles } from 'react-native-unistyles';

import { useLayoutMaxWidth } from '@/components/ui/layout/layout';
import { t } from '@/text';

import { robotPresets, terminalPalettes, type RobotPreset, type TerminalPalette } from '../palette';
import { useDeskPref } from '../deskPrefs';
import { WorkerSprite } from '../components/WorkerSprite';
import { DeskFontRoot } from '../fonts/DeskFontRoot';
import { ShogModelsSettings } from '../components/ShogModelsSettings';
import { DeskText } from '../typography/DeskText';
import { DeskNotificationSettings } from '../components/DeskNotificationSettings';
import { DeskVoiceSettings } from '../components/DeskVoiceSettings';

const robots = [
    { id: 'droid', kind: 'ipdroid', pref: 'robotDroid' },
    { id: 'ipb', kind: 'ipb', pref: 'robotIpb' },
    { id: 'prompt', kind: 'cxprompt', pref: 'robotPrompt' },
    { id: 'loupe', kind: 'cxloupe', pref: 'robotLoupe' },
    { id: 'lab', kind: 'cxlab', pref: 'robotLab' },
] as const;

function RobotRow({ robot }: { robot: typeof robots[number] }) {
    const { theme } = useUnistyles();
    const [selected, setSelected] = useDeskPref(robot.pref);
    const weak = selected === 'violet' || selected === 'orange' || selected === 'blue' || selected === 'magenta';
    return <View style={{ gap: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <WorkerSprite kind={robot.kind} bulb="idle" size={40} calm testID={`ip-robot-preview-${robot.id}`} />
            <DeskText style={{ color: theme.colors.text.primary }}>{t(`ignorePrevious.robots.${robot.id}`)}</DeskText>
        </View>
        <View accessibilityRole="radiogroup" accessibilityLabel={t(`ignorePrevious.robots.${robot.id}`)} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {(Object.keys(robotPresets) as RobotPreset[]).map(preset => <Pressable
                key={preset} testID={`ip-robot-${robot.id}-${preset}`} accessibilityRole="radio"
                accessibilityLabel={t(`ignorePrevious.robots.${preset}`)} accessibilityState={{ checked: selected === preset }}
                onPress={() => setSelected(preset)}
                style={{ width: 48, height: 48, padding: 8, borderWidth: selected === preset ? 3 : 1, borderColor: selected === preset ? theme.colors.text.primary : theme.colors.border.default }}>
                <View style={{ flex: 1, backgroundColor: robotPresets[preset].body }} />
            </Pressable>)}
        </View>
        {weak ? <DeskText style={{ color: theme.colors.text.secondary }}>{t(`ignorePrevious.robots.note${selected[0].toUpperCase()}${selected.slice(1)}` as 'ignorePrevious.robots.noteViolet')}</DeskText> : null}
    </View>;
}

export function DeskSettingsScreen() {
    const router = useRouter();
    const { theme } = useUnistyles();
    const maxWidth = useLayoutMaxWidth();
    const [chatStyle, setChatStyle] = useDeskPref('chatStyle');
    const [terminalPalette, setTerminalPalette] = useDeskPref('terminalPalette');
    const [creatureEnabled, setCreatureEnabled] = useDeskPref('creatureEnabled');
    const [faces, setFaces] = useDeskPref('workerFaces');
    const [noWorker, setNoWorker] = useDeskPref('noWorkerRobot');

    return (
        <DeskFontRoot>
            <ScrollView style={{ flex: 1, backgroundColor: theme.colors.surface.base }}>
                <View style={{ width: '100%', maxWidth, alignSelf: 'center', padding: 20, gap: 24 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
                        <Pressable
                            testID="ip-settings-back"
                            accessibilityRole="button"
                            onPress={() => router.navigate('/desk')}
                            style={{ minHeight: 48, justifyContent: 'center', paddingHorizontal: 8 }}
                        >
                            <DeskText style={{ color: theme.colors.text.secondary }}>{t('ignorePrevious.settings.backToDesk')}</DeskText>
                        </Pressable>
                        <DeskText accessibilityRole="header" style={{ color: theme.colors.text.primary }}>
                            {t('ignorePrevious.settings.title')}
                        </DeskText>
                    </View>
                    <View testID="ip-settings-sections" style={{ gap: 12 }}>
                        <DeskText accessibilityRole="header" style={{ color: theme.colors.text.secondary }}>{t('ignorePrevious.chatStyle.appearance')}</DeskText>
                        <DeskText style={{ color: theme.colors.text.primary }}>{t('ignorePrevious.chatStyle.title')}</DeskText>
                        <View accessibilityRole="radiogroup" accessibilityLabel={t('ignorePrevious.chatStyle.title')} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                            {(['mask', 'terminal'] as const).map(style => (
                                <Pressable key={style} testID={`ip-chat-style-${style}`} accessibilityRole="radio"
                                    accessibilityState={{ checked: chatStyle === style }}
                                    onPress={() => setChatStyle(style)}
                                    style={{ minHeight: 48, justifyContent: 'center', paddingHorizontal: 12, borderWidth: 1, borderColor: chatStyle === style ? theme.colors.text.primary : theme.colors.border.default }}>
                                    <DeskText style={{ color: theme.colors.text.primary }}>{t(`ignorePrevious.chatStyle.${style}`)}</DeskText>
                                </Pressable>
                            ))}
                        </View>
                        {chatStyle === 'terminal' ? <>
                            <DeskText style={{ color: theme.colors.text.primary }}>{t('ignorePrevious.chatStyle.palette')}</DeskText>
                            <View accessibilityRole="radiogroup" accessibilityLabel={t('ignorePrevious.chatStyle.palette')} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                                {(Object.keys(terminalPalettes) as TerminalPalette[]).map(palette => (
                                    <Pressable key={palette} testID={`ip-chat-palette-${palette}`} accessibilityRole="radio"
                                        accessibilityState={{ checked: terminalPalette === palette }}
                                        onPress={() => setTerminalPalette(palette)}
                                        style={{ minHeight: 48, justifyContent: 'center', paddingHorizontal: 12, borderWidth: 1, borderColor: terminalPalette === palette ? theme.colors.text.primary : theme.colors.border.default }}>
                                        <DeskText style={{ color: theme.colors.text.primary }}>{t(`ignorePrevious.chatStyle.${palette}`)}</DeskText>
                                    </Pressable>
                                ))}
                            </View>
                        </> : null}
                    </View>
                    <ShogModelsSettings />
                    <View style={{ gap: 12 }}>
                        <DeskText accessibilityRole="header" style={{ color: theme.colors.text.secondary }}>{t('ignorePrevious.robots.faces')}</DeskText>
                        <View accessibilityRole="radiogroup" accessibilityLabel={t('ignorePrevious.robots.faces')} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                            {(['A', 'B'] as const).map(choice => <Pressable key={choice} testID={`ip-faces-${choice}`} accessibilityRole="radio"
                                accessibilityState={{ checked: faces === choice }} onPress={() => setFaces(choice)}
                                style={{ minHeight: 48, justifyContent: 'center', paddingHorizontal: 12, borderWidth: 1, borderColor: faces === choice ? theme.colors.text.primary : theme.colors.border.default }}>
                                <DeskText style={{ color: theme.colors.text.primary }}>{t(choice === 'A' ? 'ignorePrevious.robots.pixel' : 'ignorePrevious.robots.ascii')}</DeskText>
                            </Pressable>)}
                        </View>
                    </View>
                    <View style={{ gap: 16 }}>
                        <DeskText accessibilityRole="header" style={{ color: theme.colors.text.secondary }}>{t('ignorePrevious.robots.title')}</DeskText>
                        {robots.map(robot => <RobotRow key={robot.id} robot={robot} />)}
                        <DeskText style={{ color: theme.colors.text.primary }}>{t('ignorePrevious.robots.noWorker')}</DeskText>
                        <View accessibilityRole="radiogroup" accessibilityLabel={t('ignorePrevious.robots.noWorker')} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                            {(['droid', 'ipb'] as const).map(choice => <Pressable key={choice} testID={`ip-no-worker-${choice}`} accessibilityRole="radio"
                                accessibilityState={{ checked: noWorker === choice }} onPress={() => setNoWorker(choice)}
                                style={{ minHeight: 48, justifyContent: 'center', paddingHorizontal: 12, borderWidth: 1, borderColor: noWorker === choice ? theme.colors.text.primary : theme.colors.border.default }}>
                                <DeskText style={{ color: theme.colors.text.primary }}>{t(`ignorePrevious.robots.${choice}`)}</DeskText>
                            </Pressable>)}
                        </View>
                    </View>
                    <Pressable
                        testID="ip-settings-creature"
                        accessibilityRole="switch"
                        accessibilityLabel={t('ignorePrevious.settings.creature')}
                        accessibilityState={{ checked: creatureEnabled }}
                        onPress={() => setCreatureEnabled(!creatureEnabled)}
                        style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16, minHeight: 48 }}
                    >
                        <DeskText style={{ color: theme.colors.text.primary }}>{t('ignorePrevious.settings.creature')}</DeskText>
                        <DeskText style={{ color: theme.colors.text.secondary }}>
                            {creatureEnabled ? t('ignorePrevious.settings.on') : t('ignorePrevious.settings.off')}
                        </DeskText>
                    </Pressable>
                    <View style={{ borderTopWidth: 1, borderTopColor: theme.colors.border.default, paddingTop: 20, gap: 8 }}>
                        <DeskText accessibilityRole="header" style={{ color: theme.colors.text.secondary }}>
                            {t('ignorePrevious.settings.about')}
                        </DeskText>
                        <DeskText style={{ color: theme.colors.text.primary }}>{t('ignorePrevious.settings.credit')}</DeskText>
                        <DeskText style={{ color: theme.colors.text.secondary }}>{t('ignorePrevious.settings.forkNotice')}</DeskText>
                    </View>
                    <DeskNotificationSettings />
                    <DeskVoiceSettings />
                </View>
            </ScrollView>
        </DeskFontRoot>
    );
}
