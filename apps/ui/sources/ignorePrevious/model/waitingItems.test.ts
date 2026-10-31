import { describe, expect, it } from 'vitest';

import { summariseRequest, toWaitingItems } from './waitingItems';

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

describe('toWaitingItems', () => {
    it('flattens requests across sessions, oldest first, unknown times last', () => {
        const items = toWaitingItems([
            {
                sessionId: 's1',
                sessionTitle: 'Builder',
                requests: [
                    { id: 'r1', tool: 'Bash', kind: 'permission', arguments: { command: 'ls', description: 'List files' }, createdAt: 30 },
                    { id: 'r2', tool: 'Edit', kind: 'permission', arguments: { file_path: 'a.ts' }, createdAt: null },
                ],
            },
            {
                sessionId: 's2',
                sessionTitle: 'Reviewer',
                requests: [{ id: 'r3', tool: 'Bash', kind: 'permission', arguments: { command: 'pwd' }, createdAt: 10 }],
            },
        ]);
        expect(items.map((i) => i.key)).toEqual(['s2:r3', 's1:r1', 's1:r2']);
        expect(items[1]).toMatchObject({ sessionId: 's1', requestId: 'r1', sessionTitle: 'Builder', summary: 'ls', agentNote: 'List files', kind: 'permission' });
        expect(items[2].agentNote).toBeNull();
    });
});
