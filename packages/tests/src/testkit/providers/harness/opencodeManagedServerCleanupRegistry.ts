import { stopOpenCodeManagedServerFromHomeDir } from '../opencode/stopOpenCodeManagedServerFromHomeDir';

const registeredHomes = new Set<string>();
let cleanupHandlersInstalled = false;
let cleanupPromise: Promise<void> | null = null;

async function cleanupHomes(homes: readonly string[]): Promise<void> {
  const results = await Promise.allSettled(homes.map(async (homeDir) => {
    await stopOpenCodeManagedServerFromHomeDir(homeDir);
    registeredHomes.delete(homeDir);
  }));
  const errors = results.flatMap(result => result.status === 'rejected' ? [result.reason] : []);
  if (errors.length) throw new AggregateError(errors, 'Managed-server cleanup failed; failed homes remain registered');
}

function installCleanupHandlers(): void {
  if (cleanupHandlersInstalled) return;
  cleanupHandlersInstalled = true;

  process.once('beforeExit', () => {
    void cleanupRegisteredOpenCodeManagedServerHomesBestEffort().catch(error => console.error(error));
  });

  const registerSignalCleanup = (signal: NodeJS.Signals, exitCode: number) => {
    process.once(signal, () => {
      void cleanupRegisteredOpenCodeManagedServerHomesBestEffort().catch(error => console.error(error)).finally(() => {
        process.exit(exitCode);
      });
    });
  };

  registerSignalCleanup('SIGINT', 130);
  registerSignalCleanup('SIGTERM', 143);
}

export function registerOpenCodeManagedServerHomeForCleanup(happyHomeDir: string): () => void {
  const normalizedHomeDir = happyHomeDir.trim();
  if (!normalizedHomeDir) {
    return () => {};
  }

  installCleanupHandlers();
  registeredHomes.add(normalizedHomeDir);

  return () => {
    registeredHomes.delete(normalizedHomeDir);
  };
}

export async function cleanupRegisteredOpenCodeManagedServerHomesBestEffort(): Promise<void> {
  if (cleanupPromise) {
    await cleanupPromise;
    return;
  }

  const homes = [...registeredHomes];
  cleanupPromise = cleanupHomes(homes).finally(() => {
    cleanupPromise = null;
  });
  await cleanupPromise;
}
