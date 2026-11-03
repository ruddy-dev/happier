import { describe, expect, it } from 'vitest';

import { describeRequest, summariseRequest, toWaitingItems, waitingItemGenerationKey } from './waitingItems';
import type { SessionPendingRequest } from '@/sync/domains/session/pending/listPendingSessionRequests';

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

    it('shows the command for any shell-shaped request, on one line, with invisible characters shown', () => {
        expect(summariseRequest('CodexBash', { command: ['bash', '-lc', 'rm -rf ~'] })).toBe('rm -rf ~');
        expect(summariseRequest('mcp__shell__run', { cmd: 'git status' })).toBe('git status');
        const lines = summariseRequest('Bash', { command: 'rm -rf ~\necho "listing files"' });
        expect(lines).not.toContain('\n');
        expect(lines).toContain('rm -rf ~');
        expect(lines).toContain('echo "listing files"');
        expect(lines).not.toBe('rm -rf ~ echo "listing files"');
        expect(summariseRequest('Bash', { command: 'echo \u202Eok' })).toContain('U+202E');
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

    it('shows the file and the full changes for edits', () => {
        const detail = describeRequest('Edit', { file_path: 'src/a.ts', old_string: 'x', new_string: 'changed text' });
        expect(detail).toContain('src/a.ts');
        expect(detail).toContain('changed text');
        expect(detail).toContain('"old_string": "x"');
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

describe('describeRequest: text that would read differently from what runs', () => {
    const INVISIBLE = /[\u0000-\u0008\u000B-\u001F\u007F\u00A0\u00AD\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/;

    it('shows bidi controls as visible escapes, so they cannot reorder the command', () => {
        const rlo = describeRequest('Bash', { command: ': "\u202E" ; X=\u2066 touch /work/PWNED \u2069; : \u202C' });
        expect(rlo).not.toMatch(INVISIBLE);
        expect(rlo).toContain('U+202E');
        expect(rlo).toContain('U+2066');
        expect(rlo).toContain('touch /work/PWNED');
        const isolates = describeRequest('CodexBash', { command: ['ls', '\u2066-la\u2069', '\u2067x\u2069'] });
        expect(isolates).not.toMatch(INVISIBLE);
        expect(isolates).toContain('U+2067');
    });

    it('shows zero-width, BOM, joiner, odd spaces and control characters as escapes', () => {
        for (const [command, code] of [
            ['rm -rf ./build\u200B /', 'U+200B'],
            ['cat \uFEFFREADME\u200D.md', 'U+FEFF'],
            ['cat \uFEFFREADME\u200D.md', 'U+200D'],
            ['rm a\u00A0b', 'U+00A0'],
            ['echo ok\rrm -rf ~', 'U+000D'],
        ] as const) {
            const out = describeRequest('Bash', { command });
            expect(out).not.toMatch(INVISIBLE);
            expect(out).toContain(code);
        }
        // Ordinary layout stays as it is.
        expect(describeRequest('Bash', { command: 'a\tb\nc' })).toBe('a\tb\nc');
    });

    it('collapses a flood of blank lines or spaces to a count, keeping the text after it', () => {
        const lines = describeRequest('Bash', { command: `git status${'\n'.repeat(200)}rm -rf ~${'\n'.repeat(200)}git diff` });
        expect(lines).toContain('rm -rf ~');
        expect(lines).toContain('git diff');
        expect(lines).not.toContain('\n\n\n\n');
        expect(lines).toContain('199');
        const spaces = describeRequest('Bash', { command: `echo ok${' '.repeat(3000)}; rm -rf ~` });
        expect(spaces).toContain('; rm -rf ~');
        expect(spaces).not.toContain(' '.repeat(40));
        expect(spaces).toContain('3000');
        // A newline before a harmless line hides nothing: both lines stay.
        expect(describeRequest('Bash', { command: 'rm -rf ~\necho "listing files"' })).toBe('rm -rf ~\necho "listing files"');
    });

    it("escapes the agent's note too", () => {
        const [item] = toWaitingItems([
            {
                sessionId: 's1',
                sessionTitle: 'Builder',
                disabledReason: null,
                requests: [{ id: 'r1', kind: 'permission', tool: 'Bash', arguments: { command: 'ls', description: 'List \u202Esfiles' }, createdAt: 1 } as never],
            },
        ]);
        expect(item!.agentNote).not.toMatch(INVISIBLE);
        expect(item!.agentNote).toContain('U+202E');
    });
});

describe('toWaitingItems', () => {
    const question = {
        header: 'Review', question: 'Which surface?', multiSelect: false,
        options: [{ label: 'Terminal', description: 'Check the terminal desk' }, { label: 'Slip' }],
    };
    const questionItem = (args: unknown, request: Partial<SessionPendingRequest> = {}, sessionId = 'worker') => toWaitingItems([{
        sessionId, sessionTitle: 'Builder', disabledReason: null,
        requests: [{ id: 'shared', kind: 'user_action', tool: 'AskUserQuestion', arguments: args, createdAt: 1, ...request }],
    }])[0]!;

    it('summarises a producer-shaped single question without changing its full payload or details', () => {
        const args = { questions: [question], description: 'Agent note' };
        const item = questionItem(args);
        expect(item.summary).toBe('Which surface?');
        expect(item).toMatchObject({
            tool: 'AskUserQuestion', kind: 'user_action', requestId: 'shared', createdAt: 1,
            requestContent: JSON.stringify(['user_action', 'AskUserQuestion', args]), agentNote: 'Agent note', disabledReason: null,
            detail: `AskUserQuestion ${JSON.stringify(args, null, 2)}`,
        });
        // Other consumers, including recorded permission summaries, retain their existing contract.
        expect(summariseRequest('AskUserQuestion', args)).toBe('AskUserQuestion');
        expect(questionItem(args, { kind: 'permission' }).summary).toBe('AskUserQuestion');
    });

    it.each([undefined, ' \t '])('uses the first question header when its wording is %j, without borrowing a later question', wording => {
        const args = { questions: [
            { id: 'review', header: 'Review target', question: wording, options: ['Terminal', 'Slip'] },
            { id: 'note', header: 'Note', question: 'What should I check?', freeform: { initialValue: 'Check the focused row.' } },
        ] };
        expect(questionItem(args).summary).toBe('Review target');
    });

    it('shows the first wording in a multi-question request, keeping choices and later answers out of the listing', () => {
        const args = { questions: [question, {
            header: 'Note', question: 'What should I check?', freeform: { initialValue: 'Check the focused row.' },
        }] };
        expect(questionItem(args).summary).toBe('Which surface?');
        expect(questionItem(args).detail).toContain('Check the focused row.');
    });

    it.each([
        null,
        JSON.stringify({ questions: [question] }),
        { questions: [] },
        { questions: [null] },
        { questions: [{ question: 42, header: 'Review' }] },
        { questions: [{ question: ' ', header: '\t' }] },
        { questions: [{ ...question, options: [null] }] },
        { questions: [question, null] },
        { questions: [question, question] },
        { questions: [question], happierDialog: {} },
    ])('falls back safely for unsupported or malformed question input %j', args => {
        expect(questionItem(args).summary).toBe('AskUserQuestion');
    });

    it('does not reinterpret other user-action tools or permission command/file rows as questions', () => {
        expect(questionItem({ questions: [question] }, { tool: 'ExitPlanMode' }).summary).toBe('ExitPlanMode');
        expect(questionItem({ questions: [question], command: 'echo ready' }, { kind: 'permission', tool: 'Bash' }).summary).toBe('echo ready');
        expect(questionItem({ questions: [question], file_path: 'src/a.ts' }, { kind: 'permission', tool: 'Edit' }).summary).toBe('src/a.ts');
    });

    it('uses the existing safe one-line display for wording and header-only questions', () => {
        for (const field of ['question', 'header'] as const) {
            const item = questionItem({ questions: [{ [field]: 'Review\n<target>\u202E\u200B\r', freeform: {} }] });
            expect(item.summary).toBe('Review ↵ <target>⟨U+202E⟩⟨U+200B⟩⟨U+000D⟩');
        }
        const raw = questionItem({ questions: [{ question: 'Review\u202E' }] });
        const escaped = questionItem({ questions: [{ question: 'Review⟨U+202E⟩' }] });
        expect(raw.summary).toBe(escaped.summary);
        expect(raw.key).toBe(escaped.key);
        expect(waitingItemGenerationKey(raw)).not.toBe(waitingItemGenerationKey(escaped));
    });

    it('bounds question summaries at 140 characters while retaining distinct equal-ID occurrences', () => {
        const make = (suffix: string, sessionId = 'worker') => questionItem({ questions: [{
            question: 'x'.repeat(150) + suffix,
        }] }, {}, sessionId);
        const first = make('First'); const replaced = make('Second'); const otherSession = make('Second', 'other-worker');
        expect(first.summary).toBe('x'.repeat(139) + '…');
        expect(first.summary).toBe(replaced.summary);
        expect(first.key).toBe(replaced.key);
        expect(first.key).not.toBe(otherSession.key);
        expect(first.detail).toContain('First');
        expect(replaced.detail).toContain('Second');
        expect(waitingItemGenerationKey(first)).not.toBe(waitingItemGenerationKey(replaced));
        expect(questionItem({ questions: [{ question: 'x'.repeat(140) }] }).summary).toBe('x'.repeat(140));
    });

    it.each([null, { command: 'echo ready', cwd: '/work/review' }])('escapes tool display while retaining raw permission identity with arguments %j', args => {
        const make = (tool: string) => toWaitingItems([{
            sessionId: 'worker', sessionTitle: 'Builder', disabledReason: null,
            requests: [{ id: 'shared', kind: 'permission', tool, arguments: args, createdAt: 1 }],
        }])[0]!;
        const raw = make('Read\u202E');
        const escaped = make('Read⟨U+202E⟩');
        expect(raw.tool).toBe('Read⟨U+202E⟩');
        expect(raw.tool).toBe(escaped.tool);
        expect(raw.summary).toBe(escaped.summary);
        expect(raw.detail).toBe(escaped.detail);
        expect(raw.key).toBe(escaped.key);
        expect(JSON.parse(raw.requestContent)).toEqual(['permission', 'Read\u202E', args]);
        expect(raw.requestContent).not.toBe(escaped.requestContent);
    });

    it.each(['Bash', 'Edit', 'AskUserQuestion', 'mcp__shell__run'])('preserves the ordinary tool name %s', tool => {
        const [item] = toWaitingItems([{
            sessionId: 'worker', sessionTitle: 'Builder', disabledReason: null,
            requests: [{ id: 'shared', kind: 'permission', tool, arguments: null, createdAt: 1 }],
        }]);
        expect(item).toMatchObject({ tool, summary: tool, detail: tool });
    });

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
        expect(items.map((i) => [i.sessionId, i.requestId])).toEqual([['s2', 'r3'], ['s1', 'r1'], ['s1', 'r2']]);
        expect(items[1]).toMatchObject({ sessionId: 's1', requestId: 'r1', sessionTitle: 'Builder', summary: 'ls', detail: 'ls', agentNote: 'List files', kind: 'permission' });
        expect(items[2].agentNote).toBeNull();
        expect(items[0].disabledReason).toBe('readOnly');
    });

    it('gives every request its own key, even when ids contain the separator', () => {
        const items = toWaitingItems([
            { sessionId: 'a:b', sessionTitle: 'One', disabledReason: null, requests: [{ id: 'c', tool: 'Bash', kind: 'permission', arguments: { command: 'ls' }, createdAt: 1 }] },
            { sessionId: 'a', sessionTitle: 'Two', disabledReason: null, requests: [{ id: 'b:c', tool: 'Bash', kind: 'permission', arguments: { command: 'rm -rf ~' }, createdAt: 2 }] },
        ]);
        expect(new Set(items.map((i) => i.key)).size).toBe(2);
    });
});


describe('approval display regressions', () => {
    it('F1: escapes combining floods without changing ordinary accents', () => {
        const command = 'echo x' + '\u0338'.repeat(200) + '; rm -rf /work/build';
        const out = describeRequest('Bash', { command });
        expect(out).not.toContain('\u0338');
        expect(out.match(/U\+0338/g)).toHaveLength(200);
        expect(out).toContain('; rm -rf /work/build');
        expect(describeRequest('Bash', { command: 'cat cafe\u0301/na\u0308me 😀' })).toBe('cat cafe\u0301/na\u0308me 😀');
        expect(describeRequest('Bash', { command: 'x\u0301\u0338' })).toBe('x⟨U+0301⟩⟨U+0338⟩');
    });

    it('F1: escapes lone surrogates while preserving paired surrogates', () => {
        expect(describeRequest('Bash', { command: 'cat x\uD800\uDC00 y\uD800 z\uDC00' }))
            .toBe('cat x\uD800\uDC00 y⟨U+D800⟩ z⟨U+DC00⟩');
    });

    it('F2: summarises unsafe argv as one-line JSON, sanitised and bounded', () => {
        for (const argv of [['sh', '-c', 'rm -rf /work/build'], ['rm', '-rf', 'my dir']]) {
            expect(summariseRequest('CodexBash', { command: argv })).toBe(JSON.stringify(argv));
            expect(summariseRequest('CodexBash', { toolCall: { rawInput: { argv } } })).toBe(JSON.stringify(argv));
        }
        const summary = summariseRequest('CodexBash', { argv: ['sh', '-c', 'echo \u202Ex\n' + 'x'.repeat(200)] });
        expect(summary).not.toContain('\n');
        expect(summary).not.toContain('\u202E');
        expect(summary).toContain('U+202E');
        expect(summary).toHaveLength(140);
        expect(summary.endsWith('…')).toBe(true);
    });

    it('F3: retains a nested description where the card can read it', () => {
        const args = { toolCall: { rawInput: { command: 'ls', description: 'nested-visible-marker', cwd: '/work' } } };
        const [item] = toWaitingItems([{ sessionId: 'probe', sessionTitle: 'Probe', disabledReason: null,
            requests: [{ id: 'nested', kind: 'permission', tool: 'X', createdAt: 1, arguments: args }] }]);
        expect(`${item.detail} ${item.agentNote}`).toContain('nested-visible-marker');
        expect(item.detail).toContain('/work');
        expect(args.toolCall.rawInput.description).toBe('nested-visible-marker');
    });

    it('F5: quotes assignment-shaped executable names but permits equals in later arguments', () => {
        const argv = ['MODE=safe', 'rm', '-rf', '/work/build'];
        expect(describeRequest('CodexBash', { argv })).toContain('"MODE=safe"');
        expect(summariseRequest('CodexBash', { argv })).toBe(JSON.stringify(argv));
        expect(describeRequest('CodexBash', { argv: ['echo', 'MODE=safe', '--x=y'] })).toBe('echo MODE=safe --x=y');
    });
});
