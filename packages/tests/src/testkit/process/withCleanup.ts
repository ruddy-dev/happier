// Preserve both operation and cleanup failures in testkit resource scopes.
export async function withCleanup<T>(operation: () => Promise<T>, cleanup: () => Promise<void>): Promise<T> {
  const operationErrors: unknown[] = [];
  try {
    return await operation();
  } catch (error) {
    operationErrors.push(error);
    throw error;
  } finally {
    try {
      await cleanup();
    } catch (cleanupError) {
      if (!operationErrors.length) throw cleanupError;
      throw new AggregateError([...operationErrors, cleanupError],
        `Operation and cleanup failed: ${operationErrors.map(String).join('; ')}; ${String(cleanupError)}`);
    }
  }
}
