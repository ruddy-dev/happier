import { vi, type Mock } from 'vitest';

type RealSync = (typeof import('@/sync/sync'))['sync'];
type RealEncryption = RealSync['encryption'];

/**
 * The members of `@/sync/sync`'s `sync` singleton that tests reach through real ops and screens.
 * The real module opens sockets and pulls in Expo-native code, so tests replace it whole.
 */
export type SyncStub = {
    encryption: {
        getSessionEncryption: Mock<RealEncryption['getSessionEncryption']>;
        getMachineEncryption: Mock<RealEncryption['getMachineEncryption']>;
    };
    publishSessionPermissionModeToMetadata: Mock<RealSync['publishSessionPermissionModeToMetadata']>;
    patchSessionMetadataWithRetry: Mock<RealSync['patchSessionMetadataWithRetry']>;
};

/** Fresh spies on every call: no encryption (plain sessions) and network writes that resolve. */
export function createSyncModuleStub(overrides: Partial<SyncStub> = {}): { sync: SyncStub } {
    return {
        sync: {
            encryption: {
                getSessionEncryption: vi.fn<RealEncryption['getSessionEncryption']>(() => null),
                getMachineEncryption: vi.fn<RealEncryption['getMachineEncryption']>(() => null),
            },
            publishSessionPermissionModeToMetadata: vi.fn<RealSync['publishSessionPermissionModeToMetadata']>(async () => undefined),
            patchSessionMetadataWithRetry: vi.fn<RealSync['patchSessionMetadataWithRetry']>(async () => undefined),
            ...overrides,
        },
    };
}

/** For `vi.mock('@/sync/sync', installSyncStub(...))`; relative `'../sync'` mocks in `sync/ops` name the same module. */
export function installSyncStub(overrides: Partial<SyncStub> = {}) {
    return () => createSyncModuleStub(overrides);
}
