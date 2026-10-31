/** Per-device desk choices. Written only on a user action, never on mount. */
import { MMKV } from 'react-native-mmkv';

const mmkv = new MMKV();
const KEY = 'ignorePrevious.coordinatorSessionId';

/** The session Luke picked as coordinator on this device. */
export function getStoredCoordinatorId(): string | null {
    return mmkv.getString(KEY) ?? null;
}

export function setStoredCoordinatorId(id: string | null): void {
    if (id) mmkv.set(KEY, id);
    else mmkv.delete(KEY);
}

const MINIMISED_KEY = 'ignorePrevious.deskMinimised';

/** Whether the Waiting and Work panels are shrunk to a thin rail beside the coordinator. */
export function getDeskMinimised(): boolean {
    return mmkv.getString(MINIMISED_KEY) === '1';
}

export function setDeskMinimised(minimised: boolean): void {
    // Stored as a string: Happier's shared MMKV test stub has no getBoolean.
    mmkv.set(MINIMISED_KEY, minimised ? '1' : '0');
}
