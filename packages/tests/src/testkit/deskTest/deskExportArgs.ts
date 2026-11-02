import { parseArgs } from 'node:util';

/** Options for the browser-free desk export command. */
export function parseDeskExportArgs(args: string[]): { rebuild: boolean } {
    const { values } = parseArgs({ args, options: { rebuild: { type: 'boolean', default: false } } });
    return { rebuild: values.rebuild };
}
