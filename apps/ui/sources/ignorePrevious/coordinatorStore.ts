import { MMKV } from 'react-native-mmkv';

const mmkv = new MMKV();
const KEY = 'ignorePrevious.coordinatorSessionId';

/** The session Luke picked as coordinator on this device. Written only when he picks one. */
export function getStoredCoordinatorId(): string | null {
    return mmkv.getString(KEY) ?? null;
}

export function setStoredCoordinatorId(id: string | null): void {
    if (id) mmkv.set(KEY, id);
    else mmkv.delete(KEY);
}
