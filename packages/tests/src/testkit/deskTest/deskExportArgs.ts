/** Options for the browser-free desk export command. */
export function parseDeskExportArgs(_args: string[]): { rebuild: boolean } {
    return { rebuild: false };
}
