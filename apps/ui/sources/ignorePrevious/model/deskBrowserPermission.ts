import { Platform } from 'react-native';

/** Native apps keep the choice, but only the browser owns these alerts. */
export function readDeskBrowserPermission(): NotificationPermission | 'unsupported' {
    if (Platform.OS !== 'web' || typeof globalThis.Notification !== 'function') return 'unsupported';
    return globalThis.Notification.permission;
}
