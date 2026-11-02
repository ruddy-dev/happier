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

    it('joins an argument list only when every argument is plain text a shell reads the same way', () => {
        // Joined, `#` reads as a comment and hides `--force`; execve passes both.
        const comment = describeRequest('CodexBash', { command: ['git', 'push', '#', '--force'] });
        expect(comment).not.toBe('git push # --force');
        expect(comment).toContain('"#"');
        expect(comment).toContain('"--force"');
        // Each of these reads differently in a shell than in the argument list.
        for (const part of ['*', '~', ';', '|', '&', '$HOME', '`id`', 'a\nb', '']) {
            expect(describeRequest('CodexBash', { command: ['rm', '-rf', part] })).not.toBe(`rm -rf ${part}`);
        }
        expect(describeRequest('CodexBash', { command: ['git', 'commit', '-m', 'fix:x', '--author=a@b.c', './src/a_b-1.ts'] })).toBe(
            'git commit -m fix:x --author=a@b.c ./src/a_b-1.ts',
        );
    });

    it('shows what the extra arguments of a shell wrapper become, so a script that runs $0 says what $0 is', () => {
        const out = describeRequest('CodexBash', { command: ['bash', '-lc', 'eval "$0"', 'rm -rf ~'] });
        expect(out).toContain('eval "$0"');
        expect(out).toContain('$0 = "rm -rf ~"');
        const two = describeRequest('CodexBash', { command: ['bash', '-lc', 'echo "$1"', 'x', 'y z'] });
        expect(two).toContain('$0 = "x"');
        expect(two).toContain('$1 = "y z"');
    });

    it('shows every field beside the command, since each can change what runs', () => {
        const cwd = describeRequest('CodexBash', { command: 'rm -rf *', cwd: '/work/home' });
        expect(cwd).toContain('rm -rf *');
        expect(cwd).toContain('"cwd": "/work/home"');
        expect(describeRequest('Bash', { command: 'ls', dangerouslyDisableSandbox: true })).toContain('"dangerouslyDisableSandbox": true');
        const codex = describeRequest('CodexBash', {
            command: ['git', 'status'],
            workdir: '/work/repo',
            with_escalated_permissions: true,
            justification: 'needs network',
        });
        expect(codex).toContain('git status');
        expect(codex).toContain('"with_escalated_permissions": true');
        expect(codex).toContain('"workdir": "/work/repo"');
        const mcp = describeRequest('mcp__deploy__run', { command: 'git status', target: 'prod', force: true });
        expect(mcp).toContain('git status');
        expect(mcp).toContain('"target": "prod"');
        // Two commands: both are shown, not just the first one found.
        const two = describeRequest('X', { command: 'ls', cmd: ['rm', '-rf', '/'] });
        expect(two).toContain('ls');
        expect(two).toContain('"rm"');
        // A JSON-encoded argument string is read the same way as the object it encodes.
        const encoded = describeRequest('CodexBash', JSON.stringify({ command: ['rm', '-rf', 'my dir'] }));
        expect(encoded).not.toContain('rm -rf my dir');
        expect(encoded).toContain('"my dir"');
        expect(describeRequest('CodexBash', JSON.stringify(['rm', '-rf', 'my dir']))).toContain('"my dir"');
        // The agent's description is shown on the card as its note, so it isn't repeated here.
        expect(describeRequest('Bash', { command: 'ls', description: 'List files' })).toBe('ls');
    });

    it('shows the file for edits', () => {
        expect(describeRequest('Edit', { file_path: 'src/a.ts', old_string: 'x' })).toBe('src/a.ts');
    });

    it('shows the arguments of any other tool, to the last character', () => {
        const out = describeRequest('WebFetch', { url: 'https://example.invalid/x' });
        expect(out).toContain('WebFetch');
        expect(out).toContain('https://example.invalid/x');
        const long = describeRequest('mcp__notes__write', { body: 'y'.repeat(5000) + 'TAIL' });
        expect(long).toContain('TAIL');
        // A long script in an argument list the card can't join: its end is what runs last.
        const codex = describeRequest('CodexBash', { command: ['sh', '-c', `echo ${'a'.repeat(3000)}; rm -rf ~`] });
        expect(codex).toContain('rm -rf ~');
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
