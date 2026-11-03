import * as React from 'react';
import { Platform, Pressable, View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';

import { t } from '@/text';
import { useDeskPref } from '../deskPrefs';
import { readDeskBrowserPermission } from '../model/deskBrowserPermission';
import { DeskText } from '../typography/DeskText';

export function DeskNotificationSettings() {
    const { theme } = useUnistyles();
    const [choice, setChoice] = useDeskPref('deskNotify');
    const [permission, setPermission] = React.useState(readDeskBrowserPermission);
    const [requesting, setRequesting] = React.useState(false);
    const [requestFailed, setRequestFailed] = React.useState(false);

    React.useEffect(() => {
        if (Platform.OS !== 'web' || typeof window === 'undefined' || typeof document === 'undefined') return;
        const refresh = () => setPermission(readDeskBrowserPermission());
        window.addEventListener('focus', refresh);
        document.addEventListener('visibilitychange', refresh);
        return () => {
            window.removeEventListener('focus', refresh);
            document.removeEventListener('visibilitychange', refresh);
        };
    }, []);

    const allow = async () => {
        if (readDeskBrowserPermission() !== 'default' || requesting) {
            setPermission(readDeskBrowserPermission());
            return;
        }
        setRequesting(true);
        setRequestFailed(false);
        try {
            setPermission(await globalThis.Notification.requestPermission());
        } catch {
            setPermission(readDeskBrowserPermission());
            setRequestFailed(true);
        } finally {
            setRequesting(false);
        }
    };

    return <View style={{ gap: 12 }}>
        <DeskText accessibilityRole="header" style={{ color: theme.colors.text.secondary }}>{t('ignorePrevious.notifications.title')}</DeskText>
        <DeskText style={{ color: theme.colors.text.primary }}>{t('ignorePrevious.notifications.tellMeWhen')}</DeskText>
        <View accessibilityRole="radiogroup" accessibilityLabel={t('ignorePrevious.notifications.tellMeWhen')} style={{ gap: 8 }}>
            {(['every', 'blocked'] as const).map(value => <Pressable
                key={value} testID={`ip-notify-${value}`} accessibilityRole="radio"
                accessibilityLabel={t(`ignorePrevious.notifications.${value}`)}
                accessibilityHint={t(`ignorePrevious.notifications.${value}Detail`)}
                accessibilityState={{ checked: choice === value }}
                onPress={() => setChoice(value)}
                style={{ minHeight: 48, justifyContent: 'center', paddingHorizontal: 12, paddingVertical: 8, gap: 4, borderWidth: 1, borderColor: choice === value ? theme.colors.text.primary : theme.colors.border.default }}
            >
                <DeskText style={{ color: theme.colors.text.primary }}>{t(`ignorePrevious.notifications.${value}`)}</DeskText>
                <DeskText style={{ color: theme.colors.text.secondary, fontSize: 12 }}>{t(`ignorePrevious.notifications.${value}Detail`)}</DeskText>
            </Pressable>)}
        </View>
        <DeskText style={{ color: theme.colors.text.secondary }}>{t('ignorePrevious.notifications.note')}</DeskText>
        {permission === 'default' ? <Pressable
            testID="ip-notify-allow" accessibilityRole="button" accessibilityState={{ disabled: requesting }} disabled={requesting}
            onPress={allow}
            style={{ minHeight: 48, justifyContent: 'center', paddingHorizontal: 12, alignSelf: 'flex-start', borderWidth: 1, borderColor: theme.colors.border.default }}
        >
            <DeskText style={{ color: theme.colors.text.primary }}>{t('ignorePrevious.notifications.allow')}</DeskText>
        </Pressable> : <DeskText testID="ip-notify-permission" style={{ color: theme.colors.text.secondary }}>
            {permission === 'granted' ? t('ignorePrevious.notifications.on')
                : permission === 'denied' ? t('ignorePrevious.notifications.denied')
                    : Platform.OS === 'web' ? t('ignorePrevious.notifications.unsupported') : t('ignorePrevious.notifications.native')}
        </DeskText>}
        {requestFailed ? <DeskText accessibilityRole="alert" style={{ color: theme.colors.text.secondary }}>{t('ignorePrevious.notifications.permissionFailed')}</DeskText> : null}
    </View>;
}
