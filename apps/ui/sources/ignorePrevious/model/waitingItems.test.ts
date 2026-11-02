import { describe, expect, it } from 'vitest';

import { describeRequest, summariseRequest, toWaitingItems } from './waitingItems';

describe('summariseRequest', () => {
    it('shows the command for Bash and the file for edits', () => {
        expect(summariseRequest('Bash', { command: 'rm -rf build' })).toBe('rm -rf build');
        expect(summariseRequest('Edit', { file_path: 'src/a.ts', old_string: 'x' })).toBe('src/a.ts');
        expect(summariseRequest('Write', { file_path: 'b.md' })).toBe('b.md');
    });

    it('falls back to the tool name for malformed or unknown arguments', () => {
        expect(summariseRequest('Bash', null)).toBe('Bash');
        expect(summariseRequest('Bash', { command: 42 })).toBe('Bash');
        expect(summariseRequest('Edit', { file_path: ['a'] })).toBe('Edit');
        expect(summariseRequest('WebFetch', { url: 'https://x' })).toBe('WebFetch');
    });

    it('cuts long summaries to 140 characters', () => {
        const out = summariseRequest('Bash', { command: 'x'.repeat(300) });
        expect(out).toHaveLength(140);
        expect(out.endsWith('…')).toBe(true);
    });
});

describe('describeRequest', () => {
    it('returns the whole command for any tool, uncut', () => {
        const command = 'cd build && ' + 'echo a '.repeat(40) + '&& rm -rf /tmp/x';
        expect(describeRequest('Bash', { command })).toBe(command);
        expect(describeRequest('CodexBash', { command: ['bash', '-lc', 'git push --force'] })).toBe('git push --force');
    });

    it('returns an env prelude untouched', () => {
        expect(describeRequest('Bash', { command: 'FOO=1 rm -rf x' })).toBe('FOO=1 rm -rf x');
    });

    it('shows the argument list itself when joining it with spaces would hide where one argument ends', () => {
        const out = describeRequest('CodexBash', { command: ['rm', '-rf', 'my dir'] });
        expect(out).not.toBe('rm -rf my dir');
        expect(out).toContain('"my dir"');
        // A plain argv with no spaces inside an argument reads the same joined.
        expect(describeRequest('CodexBash', { argv: ['git', 'status'] })).toBe('git status');
    });

    it('shows the file for edits', () => {
        expect(describeRequest('Edit', { file_path: 'src/a.ts', old_string: 'x' })).toBe('src/a.ts');
    });

    it('shows the arguments of any other tool, capped at 2000 characters', () => {
        const out = describeRequest('WebFetch', { url: 'https://example.invalid/x' });
        expect(out).toContain('WebFetch');
        expect(out).toContain('https://example.invalid/x');
        const long = describeRequest('mcp__notes__write', { body: 'y'.repeat(5000) });
        expect(long).toHaveLength(2000);
        expect(long.endsWith('…')).toBe(true);
        expect(describeRequest('ExitPlanMode', undefined)).toBe('ExitPlanMode');
    });
});

describe('toWaitingItems', () => {
    it('flattens requests across sessions, oldest first, unknown times last', () => {
        const items = toWaitingItems([
            {
                sessionId: 's1',
                sessionTitle: 'Builder',
                disabledReason: null,
                requests: [
                    { id: 'r1', tool: 'Bash', kind: 'permission', arguments: { command: 'ls', description: 'List files' }, createdAt: 30 },
                    { id: 'r2', tool: 'Edit', kind: 'permission', arguments: { file_path: 'a.ts' }, createdAt: null },
                ],
            },
            {
                sessionId: 's2',
                sessionTitle: 'Reviewer',
                disabledReason: 'readOnly',
                requests: [{ id: 'r3', tool: 'Bash', kind: 'permission', arguments: { command: 'pwd' }, createdAt: 10 }],
            },
        ]);
        expect(items.map((i) => i.key)).toEqual(['s2:r3', 's1:r1', 's1:r2']);
        expect(items[1]).toMatchObject({ sessionId: 's1', requestId: 'r1', sessionTitle: 'Builder', summary: 'ls', detail: 'ls', agentNote: 'List files', kind: 'permission' });
        expect(items[2].agentNote).toBeNull();
        expect(items[0].disabledReason).toBe('readOnly');
    });
});
