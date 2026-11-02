import { act } from 'react-test-renderer';
import { MMKV } from 'react-native-mmkv';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderHook, standardCleanup } from '@/dev/testkit';
import { readReactNativeMmkvStubEntries } from '@/dev/testkit/mocks/mmkv';

import { deskPrefs, setCoordinatorOverride, setStoredCoordinatorId, setWorkCollapsed, useDeskPref } from './deskPrefs';

afterEach(() => {
    standardCleanup();
    setCoordinatorOverride(null);
});

describe('device-local desk prefs', () => {
    it('reads defaults without writing, including the enabled creature', async () => {
        const hook = await renderHook(() => useDeskPref('creatureEnabled'));
        expect(hook.getCurrent()[0]).toBe(true);
        expect(deskPrefs.get('coordinatorSessionId')).toBeNull();
        expect(deskPrefs.get('workCollapsed')).toBe(false);
        expect(deskPrefs.get('approvalsOpen')).toBe(false);
        expect(deskPrefs.get('chatStyle')).toBe('mask');
        expect(deskPrefs.get('terminalPalette')).toBe('tokyo');
        expect(deskPrefs.get('thinkingAndTools')).toBe('reply-link');
        expect(readReactNativeMmkvStubEntries()).toEqual([]);
    });

    it('persists chat choices without changing the deferred thinking/tool preference', () => {
        deskPrefs.set('chatStyle', 'terminal');
        deskPrefs.set('terminalPalette', 'terminalPaper');
        expect(deskPrefs.get('chatStyle')).toBe('terminal');
        expect(deskPrefs.get('terminalPalette')).toBe('terminalPaper');
        expect(new MMKV().getString('ignorePrevious.chatStyle')).toBe('terminal');
        expect(deskPrefs.get('thinkingAndTools')).toBe('reply-link');
    });

    it('reads the existing keys and writes their unchanged string representation', () => {
        const persisted = new MMKV();
        persisted.set('ignorePrevious.coordinatorSessionId', 'stored-coordinator');
        persisted.set('ignorePrevious.deskMinimised', '1');
        persisted.set('ignorePrevious.approvalsOpen', '1');
        expect(deskPrefs.get('coordinatorSessionId')).toBe('stored-coordinator');
        expect(deskPrefs.get('workCollapsed')).toBe(true);
        expect(deskPrefs.get('approvalsOpen')).toBe(true);
        deskPrefs.set('workCollapsed', false);
        deskPrefs.set('approvalsOpen', false);
        deskPrefs.set('coordinatorSessionId', null);
        expect(persisted.getString('ignorePrevious.deskMinimised')).toBe('0');
        expect(persisted.getString('ignorePrevious.approvalsOpen')).toBe('0');
        expect(persisted.getString('ignorePrevious.coordinatorSessionId')).toBeUndefined();
    });

    it('persists creature off in MMKV and reads it after a hook remount', async () => {
        const hook = await renderHook(() => useDeskPref('creatureEnabled'));
        await act(async () => hook.getCurrent()[1](false));
        expect(new MMKV().getString('ignorePrevious.creatureEnabled')).toBe('0');
        await hook.unmount();
        const remounted = await renderHook(() => useDeskPref('creatureEnabled'));
        expect(remounted.getCurrent()[0]).toBe(false);
    });

    it('notifies only the subscribed key and stops after unsubscribe, including legacy writes', () => {
        const listener = vi.fn();
        const coordinator = vi.fn();
        const unsubscribe = deskPrefs.subscribe('workCollapsed', listener);
        const unsubscribeCoordinator = deskPrefs.subscribe('coordinatorSessionId', coordinator);
        setWorkCollapsed(true);
        expect(listener).toHaveBeenCalledTimes(1);
        expect(coordinator).not.toHaveBeenCalled();
        unsubscribe();
        deskPrefs.set('workCollapsed', false);
        setStoredCoordinatorId('picked-coordinator');
        expect(listener).toHaveBeenCalledTimes(1);
        expect(coordinator).toHaveBeenCalledTimes(1);
        unsubscribeCoordinator();
    });

    it('shares fixture overrides with typed consumers without persisting fixture picks or clears', async () => {
        setStoredCoordinatorId('stored-coordinator');
        const hook = await renderHook(() => useDeskPref('coordinatorSessionId'));
        await act(async () => setCoordinatorOverride('fixture-coordinator'));
        expect(hook.getCurrent()[0]).toBe('fixture-coordinator');
        await act(async () => hook.getCurrent()[1]('picked-under-fixture'));
        expect(hook.getCurrent()[0]).toBe('picked-under-fixture');
        expect(new MMKV().getString('ignorePrevious.coordinatorSessionId')).toBe('stored-coordinator');
        await act(async () => hook.getCurrent()[1](null));
        expect(hook.getCurrent()[0]).toBeNull();
        expect(new MMKV().getString('ignorePrevious.coordinatorSessionId')).toBe('stored-coordinator');
        await act(async () => setCoordinatorOverride(null));
        expect(hook.getCurrent()[0]).toBe('stored-coordinator');
    });
});
