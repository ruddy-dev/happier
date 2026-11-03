import * as React from 'react';
import { MMKV } from 'react-native-mmkv';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderScreen, standardCleanup } from '@/dev/testkit';
import { readReactNativeMmkvStubEntries } from '@/dev/testkit/mocks/mmkv';
import { deskPrefs } from '../deskPrefs';
import { DeskNotificationSettings } from './DeskNotificationSettings';

const platform = vi.hoisted(() => ({ os: 'web' }));
vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock({ Platform: { get OS() { return platform.os; } } });
});

class BrowserNotification {
    static permission: NotificationPermission = 'default';
    static requestPermission = vi.fn(async (): Promise<NotificationPermission> => {
        BrowserNotification.permission = 'granted';
        return 'granted';
    });
}

beforeEach(() => {
    platform.os = 'web';
    BrowserNotification.permission = 'default';
    BrowserNotification.requestPermission.mockClear();
    vi.stubGlobal('Notification', BrowserNotification);
});
afterEach(() => {
    standardCleanup();
    vi.unstubAllGlobals();
});

describe('browser notification settings', () => {
    it('defaults to blocked without a storage write or permission prompt', async () => {
        const screen = await renderScreen(<DeskNotificationSettings />);
        expect(screen.findByTestId('ip-notify-blocked')?.props.accessibilityState).toEqual({ checked: true });
        expect(screen.findByTestId('ip-notify-every')?.props.accessibilityState).toEqual({ checked: false });
        expect(readReactNativeMmkvStubEntries()).toEqual([]);
        expect(BrowserNotification.requestPermission).not.toHaveBeenCalled();
    });

    it('persists only a pressed choice and reads it after remount, without requesting permission', async () => {
        const screen = await renderScreen(<DeskNotificationSettings />);
        await screen.pressByTestIdAsync('ip-notify-every');
        expect(readReactNativeMmkvStubEntries()).toEqual([['ignorePrevious.deskNotify', 'every']]);
        await screen.unmount();
        const remounted = await renderScreen(<DeskNotificationSettings />);
        expect(remounted.findByTestId('ip-notify-every')?.props.accessibilityState).toEqual({ checked: true });
        await remounted.pressByTestIdAsync('ip-notify-blocked');
        expect(deskPrefs.get('deskNotify')).toBe('blocked');
        expect(BrowserNotification.requestPermission).not.toHaveBeenCalled();
    });

    it('checks allowed stored values and falls back without repairing storage on mount', async () => {
        new MMKV().set('ignorePrevious.deskNotify', 'invalid');
        const screen = await renderScreen(<DeskNotificationSettings />);
        expect(screen.findByTestId('ip-notify-blocked')?.props.accessibilityState).toEqual({ checked: true });
        expect(new MMKV().getString('ignorePrevious.deskNotify')).toBe('invalid');
    });

    it.each([
        ['granted', 'on'],
        ['default', 'Allow browser alerts'],
        ['denied', 'blocked in this browser; change it in the site settings'],
        ['unsupported', "this browser can't show alerts"],
    ] as const)('shows the %s permission state without prompting', async (permission, text) => {
        if (permission === 'unsupported') vi.stubGlobal('Notification', undefined);
        else BrowserNotification.permission = permission;
        const screen = await renderScreen(<DeskNotificationSettings />);
        if (permission === 'default') expect(screen.getTextContent()).toContain(text);
        else expect(screen.findByTestId('ip-notify-permission')?.props.children).toBe(text);
        expect(screen.findByTestId('ip-notify-allow') !== null).toBe(permission === 'default');
        expect(BrowserNotification.requestPermission).not.toHaveBeenCalled();
    });

    it('requests permission only on the allow button and shows the result', async () => {
        const screen = await renderScreen(<DeskNotificationSettings />);
        await screen.pressByTestIdAsync('ip-notify-every');
        expect(BrowserNotification.requestPermission).not.toHaveBeenCalled();
        await screen.pressByTestIdAsync('ip-notify-allow');
        expect(BrowserNotification.requestPermission).toHaveBeenCalledTimes(1);
        expect(screen.findByTestId('ip-notify-allow')).toBeNull();
        expect(screen.findByTestId('ip-notify-permission')?.props.children).toBe('on');
    });

    it.each(['ios', 'android'])('keeps the preference on %s and explains that alerts are browser-only', async os => {
        platform.os = os;
        BrowserNotification.permission = 'granted';
        const screen = await renderScreen(<DeskNotificationSettings />);
        expect(screen.getTextContent()).toContain('Alerts are browser-only');
        expect(screen.findByTestId('ip-notify-allow')).toBeNull();
        await screen.pressByTestIdAsync('ip-notify-every');
        expect(deskPrefs.get('deskNotify')).toBe('every');
        expect(BrowserNotification.requestPermission).not.toHaveBeenCalled();
    });
});
