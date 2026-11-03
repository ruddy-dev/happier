/** Per-device desk choices. Written only on a user action, never on mount. */
import * as React from 'react';
import { isIssueArchiveTarget } from './model/issueArchiveOperation';
import { robotColourDefaults, robotPresets, terminalPalettes, type RobotPreset, type TerminalPalette } from './palette';
import { MMKV } from 'react-native-mmkv';

const mmkv = new MMKV();

export type ChatStyle = 'mask' | 'terminal';

const keys = {
    shogModels: { storageKey: 'ignorePrevious.shogModels', defaultValue: JSON.stringify(['claude:claude-opus-5-5', 'codex:gpt-6.1-sol', 'codex:gpt-6-astra']) },
    shogLastUsedModel: { storageKey: 'ignorePrevious.shogLastUsedModel', defaultValue: 'claude:claude-opus-5-5' },
    chatStyle: { storageKey: 'ignorePrevious.chatStyle', defaultValue: 'mask' as ChatStyle, allowedValues: ['mask', 'terminal'] as readonly string[] },
    terminalPalette: { storageKey: 'ignorePrevious.terminalPalette', defaultValue: 'tokyo' as TerminalPalette, allowedValues: Object.keys(terminalPalettes) },
    // C17 will consume this preference in the transcript pipeline.
    thinkingAndTools: { storageKey: 'ignorePrevious.thinkingAndTools', defaultValue: 'reply-link' as 'reply-link' | 'hidden', allowedValues: ['reply-link', 'hidden'] as readonly string[] },
    robotDroid: { storageKey: 'ignorePrevious.robotDroid', defaultValue: robotColourDefaults.droid as RobotPreset, allowedValues: Object.keys(robotPresets) },
    robotIpb: { storageKey: 'ignorePrevious.robotIpb', defaultValue: robotColourDefaults.b as RobotPreset, allowedValues: Object.keys(robotPresets) },
    robotPrompt: { storageKey: 'ignorePrevious.robotPrompt', defaultValue: robotColourDefaults.prompt as RobotPreset, allowedValues: Object.keys(robotPresets) },
    robotLoupe: { storageKey: 'ignorePrevious.robotLoupe', defaultValue: robotColourDefaults.loupe as RobotPreset, allowedValues: Object.keys(robotPresets) },
    robotLab: { storageKey: 'ignorePrevious.robotLab', defaultValue: robotColourDefaults.lab as RobotPreset, allowedValues: Object.keys(robotPresets) },
    noWorkerRobot: { storageKey: 'ignorePrevious.noWorkerRobot', defaultValue: 'droid' as 'droid' | 'ipb', allowedValues: ['droid', 'ipb'] as readonly string[] },
    workerFaces: { storageKey: 'ignorePrevious.workerFaces', defaultValue: 'A' as 'A' | 'B', allowedValues: ['A', 'B'] as readonly string[] },
    coordinatorSessionId: { storageKey: 'ignorePrevious.coordinatorSessionId', defaultValue: null as string | null },
    workCollapsed: { storageKey: 'ignorePrevious.deskMinimised', defaultValue: false as boolean },
    approvalsOpen: { storageKey: 'ignorePrevious.approvalsOpen', defaultValue: false as boolean },
    creatureEnabled: { storageKey: 'ignorePrevious.creatureEnabled', defaultValue: true as boolean },
    deskNotify: { storageKey: 'ignorePrevious.deskNotify', defaultValue: 'blocked' as 'every' | 'blocked', allowedValues: ['every', 'blocked'] as readonly string[] },
    deskHoldSpace: { storageKey: 'ignorePrevious.deskHoldSpace', defaultValue: true as boolean },
};

export type DeskPrefKey = keyof typeof keys;
export type DeskPrefValue<K extends DeskPrefKey> = (typeof keys)[K]['defaultValue'];

// The dev fixture and picks made while it is active never change the device's stored coordinator.
let coordinatorOverride: { id: string | null } | null = null;
const listeners = new Map<DeskPrefKey, Set<() => void>>();

function notify(key: DeskPrefKey): void {
    for (const listener of [...(listeners.get(key) ?? [])]) listener();
}

function get<K extends DeskPrefKey>(key: K): DeskPrefValue<K> {
    if (key === 'coordinatorSessionId' && coordinatorOverride) return coordinatorOverride.id as DeskPrefValue<K>;
    const definition = keys[key];
    const stored = mmkv.getString(definition.storageKey);
    // Retain the original string flags, including the old deskMinimised key.
    const value = typeof definition.defaultValue === 'boolean'
        ? stored === undefined ? definition.defaultValue : stored === '1'
        : stored !== undefined && (!('allowedValues' in definition) || definition.allowedValues.includes(stored))
            ? stored : definition.defaultValue;
    return value as DeskPrefValue<K>;
}

function set<K extends DeskPrefKey>(key: K, value: DeskPrefValue<K>): void {
    if (key === 'coordinatorSessionId' && typeof value === 'string' && isIssueArchiveTarget(value)) return;
    if (key === 'coordinatorSessionId' && coordinatorOverride) {
        coordinatorOverride = { id: typeof value === 'string' ? value : null };
    } else {
        const { storageKey } = keys[key];
        if (typeof value === 'boolean') mmkv.set(storageKey, value ? '1' : '0');
        else if (value) mmkv.set(storageKey, value);
        else mmkv.delete(storageKey);
    }
    notify(key);
}

function subscribe(key: DeskPrefKey, listener: () => void): () => void {
    let subscribers = listeners.get(key);
    if (!subscribers) {
        subscribers = new Set();
        listeners.set(key, subscribers);
    }
    subscribers.add(listener);
    return () => { subscribers.delete(listener); };
}

// Subscriptions cover this JS runtime. Another browser tab's writes are not pushed to subscribers.
export const deskPrefs = { get, set, subscribe };

export function useDeskPref<K extends DeskPrefKey>(key: K) {
    const subscribeKey = React.useCallback((listener: () => void) => subscribe(key, listener), [key]);
    const snapshot = React.useCallback(() => get(key), [key]);
    const setValue = React.useCallback((value: DeskPrefValue<K>) => set(key, value), [key]);
    const value = React.useSyncExternalStore(subscribeKey, snapshot, snapshot);
    return [value, setValue] as const;
}

/** Null releases the fixture override and restores the stored pick. */
export function setCoordinatorOverride(id: string | null): void {
    if (id !== null && isIssueArchiveTarget(id)) return;
    coordinatorOverride = id === null ? null : { id };
    notify('coordinatorSessionId');
}

export function getStoredCoordinatorId(): string | null { return get('coordinatorSessionId'); }
export function setStoredCoordinatorId(id: string | null): void { set('coordinatorSessionId', id); }
export function subscribeStoredCoordinatorId(listener: () => void): () => void { return subscribe('coordinatorSessionId', listener); }
export function getWorkCollapsed(): boolean { return get('workCollapsed'); }
export function setWorkCollapsed(collapsed: boolean): void { set('workCollapsed', collapsed); }
export function getApprovalsOpen(): boolean { return get('approvalsOpen'); }
export function setApprovalsOpen(open: boolean): void { set('approvalsOpen', open); }
