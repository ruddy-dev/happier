import * as React from 'react';
import { Platform, Pressable, View, type PressableProps } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { Popover } from '@/components/ui/popover/Popover';
import { FloatingOverlay } from '@/components/ui/overlays/FloatingOverlay';
import { t } from '@/text';
import { initialRunSettings, offersUltracode, runEffortControl, runSettingsReducer, type DeskModel, type DeskEffort, type RunSettingsAction } from '../model/runSettings';
import { useDeskPopup } from '../popups/useDeskPopup';
import { DeskText } from '../typography/DeskText';

const models = ['default', 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-1'] as const;
const modelKeys = { default: 'default', 'claude-opus-5-5': 'opus', 'claude-sonnet-5-5': 'sonnet', 'claude-haiku-5-5': 'haiku', 'claude-fable-5-1': 'fable' } as const;
const modelLabel = (model: DeskModel) => t(`ignorePrevious.runSettings.models.${modelKeys[model]}`);
const effortLabel = (effort: DeskEffort) => t(`ignorePrevious.runSettings.efforts.${effort}`);

function menuItemRole(kind: 'radio' | 'checkbox'): Pick<PressableProps, 'role'> {
    if (Platform.OS !== 'web') return { role: kind };
    // @ts-expect-error React Native omits these ARIA roles; React Native Web forwards them to the DOM.
    return { role: kind === 'radio' ? 'menuitemradio' : 'menuitemcheckbox' };
}

/** Fixture-only settings. Item 2.8 owns session writes and real turn-state wiring. */
export function RunSettingsMenu({ midTurn = false }: { midTurn?: boolean }) {
    const { theme } = useUnistyles();
    const [settings, setSettings] = React.useState(initialRunSettings);
    const [open, setOpen] = React.useState(false);
    const [changedDuringTurn, setChangedDuringTurn] = React.useState(false);
    const openerRef = React.useRef<View>(null);
    const contentRef = React.useRef<View>(null);
    const close = () => setOpen(false);
    useDeskPopup({ open, onClose: close, openerRef, contentRef });
    React.useEffect(() => { if (!midTurn) setChangedDuringTurn(false); }, [midTurn]);
    const change = (action: RunSettingsAction) => {
        const next = runSettingsReducer(settings, action);
        if (next === settings) return;
        setSettings(next);
        if (midTurn) setChangedDuringTurn(true);
    };
    const effort = runEffortControl(settings);
    const summary = `${modelLabel(settings.model)} · ${settings.ultracode ? t('ignorePrevious.runSettings.ultracode') : effortLabel(settings.effort)} · ${t('ignorePrevious.runSettings.plansOnly')}`;
    const headingStyle = { color: theme.colors.text.secondary, paddingHorizontal: 10, paddingTop: 8, paddingBottom: 3, fontSize: 12, fontWeight: '600' as const };
    const noteStyle = { color: theme.colors.text.secondary, paddingHorizontal: 10, paddingVertical: 6, fontSize: 12 };
    const choiceStyle = { paddingHorizontal: 10, paddingVertical: 8, borderRadius: 6 };
    return <>
        <View style={{ flexShrink: 1 }}>
            <Pressable ref={openerRef} testID="ip-run-settings" accessibilityRole="button" accessibilityLabel={summary}
                aria-expanded={open} accessibilityState={{ expanded: open }} aria-haspopup="menu" onPress={() => setOpen(value => !value)}
                style={{ paddingHorizontal: 9, paddingVertical: 4, borderRadius: 12 }}>
                <DeskText style={{ color: theme.colors.text.primary, fontSize: 13, fontWeight: settings.ultracode ? '700' : '400' }}>{summary}</DeskText>
            </Pressable>
            {midTurn && changedDuringTurn ? <DeskText testID="ip-run-next-turn" accessibilityLiveRegion="polite" style={noteStyle}>{t('ignorePrevious.runSettings.nextTurn')}</DeskText> : null}
        </View>
        <Popover open={open} anchorRef={openerRef} placement="top" portal={{ web: true }}
            {...(Platform.OS === 'web' ? { backdrop: false as const } : { backdrop: true as const, onRequestClose: close })} maxWidthCap={560} edgePadding={8}>
            {({ maxHeight }) => <FloatingOverlay maxHeight={maxHeight} containerStyle={{ width: 560, maxWidth: '100%' }}>
                <View ref={contentRef} testID="ip-run-menu" accessibilityRole="menu" accessibilityLabel={t('ignorePrevious.runSettings.title')}
                    onLayout={() => {
                        // Focus the selected model after the portaled host is mounted. Picks keep focus.
                        if (Platform.OS === 'web' && contentRef.current instanceof HTMLElement && !contentRef.current.contains(document.activeElement)) {
                            contentRef.current.querySelector<HTMLElement>('[role="menuitemradio"][aria-checked="true"]')?.focus();
                        }
                    }}>
                    <View style={{ flexDirection: 'row', gap: 10, padding: 6 }}>
                        <View style={{ flex: 1, minWidth: 0 }} role="group" accessibilityLabel={t('ignorePrevious.runSettings.model')}>
                            <DeskText style={headingStyle}>{t('ignorePrevious.runSettings.model')}</DeskText>
                            {models.map(model => <Pressable key={model} testID={`ip-run-model-${model}`} {...menuItemRole('radio')}
                                aria-checked={settings.model === model} accessibilityState={{ checked: settings.model === model }} onPress={() => change({ type: 'model', model })}
                                style={[choiceStyle, settings.model === model ? { backgroundColor: theme.colors.surface.selected } : null]}>
                                <DeskText style={{ color: theme.colors.text.primary }}>{modelLabel(model)}</DeskText>
                                <DeskText style={{ color: theme.colors.text.secondary, fontSize: 12 }}>{t(`ignorePrevious.runSettings.modelDescriptions.${modelKeys[model]}`)}</DeskText>
                            </Pressable>)}
                        </View>
                        <View style={{ flex: 1, minWidth: 0 }}>
                            <View testID="ip-run-effort-group" role="group" accessibilityLabel={t('ignorePrevious.runSettings.effort')} aria-disabled={effort.disabled} accessibilityState={{ disabled: effort.disabled }}>
                                <DeskText style={headingStyle}>{t(settings.ultracode ? 'ignorePrevious.runSettings.effortLocked' : 'ignorePrevious.runSettings.effort')}</DeskText>
                                {effort.levels.length === 0 ? <DeskText testID="ip-run-effort-unavailable" style={noteStyle}>{t('ignorePrevious.runSettings.effortUnavailable')}</DeskText> : null}
                                {effort.levels.map(value => <Pressable key={value} testID={`ip-run-effort-${value}`} {...menuItemRole('radio')}
                                    disabled={effort.disabled} aria-checked={effort.effectiveValue === value} accessibilityState={{ checked: effort.effectiveValue === value, disabled: effort.disabled === true }}
                                    onPress={() => change({ type: 'effort', effort: value })} style={choiceStyle}>
                                    <DeskText style={{ color: effort.disabled ? theme.colors.text.secondary : theme.colors.text.primary }}>{effortLabel(value)}</DeskText>
                                    <DeskText style={{ color: theme.colors.text.secondary, fontSize: 12 }}>{t(`ignorePrevious.runSettings.effortDescriptions.${value}`)}</DeskText>
                                </Pressable>)}
                            </View>
                            <DeskText style={headingStyle}>{t('ignorePrevious.runSettings.ultracode')}</DeskText>
                            {offersUltracode(settings.model) ? <Pressable testID="ip-run-ultracode" {...menuItemRole('checkbox')}
                                aria-checked={settings.ultracode} accessibilityState={{ checked: settings.ultracode }} onPress={() => change({ type: 'ultracode', enabled: !settings.ultracode })} style={choiceStyle}>
                                <DeskText style={{ color: theme.colors.text.primary }}>{t(settings.ultracode ? 'ignorePrevious.runSettings.ultracodeOn' : 'ignorePrevious.runSettings.ultracodeOff')}</DeskText>
                                <DeskText style={{ color: theme.colors.text.secondary, fontSize: 12 }}>{t('ignorePrevious.runSettings.ultracodeDescription')}</DeskText>
                            </Pressable> : <DeskText style={noteStyle}>{t('ignorePrevious.runSettings.ultracodeUnavailable')}</DeskText>}
                            <DeskText style={headingStyle}>{t('ignorePrevious.runSettings.permissionMode')}</DeskText>
                            <DeskText style={noteStyle}>{t('ignorePrevious.runSettings.permissionNote')}</DeskText>
                        </View>
                    </View>
                    <DeskText style={noteStyle}>{t('ignorePrevious.runSettings.footer')}</DeskText>
                </View>
            </FloatingOverlay>}
        </Popover>
    </>;
}
