/** Per-device desk choices. Written only on a user action, never on mount. */
import { MMKV } from 'react-native-mmkv';

const mmkv = new MMKV();
const KEY = 'ignorePrevious.coordinatorSessionId';

/** The session the user picked as coordinator on this device. */
export function getStoredCoordinatorId(): string | null {
    return mmkv.getString(KEY) ?? null;
}

// In-memory listeners over the MMKV key, so every desk consumer sees a pick at once. Another
// tab's pick is not seen until a reload: MMKV's own change listener isn't used.
const coordinatorListeners = new Set<() => void>();

export function setStoredCoordinatorId(id: string | null): void {
    if (id) mmkv.set(KEY, id);
    else mmkv.delete(KEY);
    for (const listener of [...coordinatorListeners]) listener();
}

/** Calls `listener` after every `setStoredCoordinatorId`; returns the unsubscribe. */
export function subscribeStoredCoordinatorId(listener: () => void): () => void {
    coordinatorListeners.add(listener);
    return () => {
        coordinatorListeners.delete(listener);
    };
}

// Key kept from the earlier "minimise panels" toggle, which also collapsed the Work panel.
const WORK_COLLAPSED_KEY = 'ignorePrevious.deskMinimised';
const APPROVALS_OPEN_KEY = 'ignorePrevious.approvalsOpen';

// Flags are stored as strings: Happier's shared MMKV test stub has no getBoolean.
function getFlag(key: string): boolean {
    return mmkv.getString(key) === '1';
}

function setFlag(key: string, on: boolean): void {
    mmkv.set(key, on ? '1' : '0');
}

/** Whether the Work panel is collapsed to a thin rail of issue labels. */
export function getWorkCollapsed(): boolean {
    return getFlag(WORK_COLLAPSED_KEY);
}

export function setWorkCollapsed(collapsed: boolean): void {
    setFlag(WORK_COLLAPSED_KEY, collapsed);
}

/** Whether the approvals drawer (what waits on you) is open beside the coordinator. */
export function getApprovalsOpen(): boolean {
    return getFlag(APPROVALS_OPEN_KEY);
}

export function setApprovalsOpen(open: boolean): void {
    setFlag(APPROVALS_OPEN_KEY, open);
}
