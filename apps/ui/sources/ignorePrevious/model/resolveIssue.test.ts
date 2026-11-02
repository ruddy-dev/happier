import { describe, expect, it } from 'vitest';

import { resolveIssue } from './resolveIssue';

describe('resolveIssue', () => {
    it('N2 tag names the issue before branch, title and path', () =>
        expect(resolveIssue({ tag: 'ATR-6-build', title: 'ATR-7 x', branch: 'atr-8-x', path: '/w/atr-9-x' })).toBe('ATR-6'));

    it('N2 absent tag falls to title', () =>
        expect(resolveIssue({ tag: null, title: 'ATR-7 x', branch: 'atr-8-x', path: null })).toBe('ATR-7'));

    it('N2 tag is trimmed and uppercased', () =>
        expect(resolveIssue({ tag: ' atr-6-build ', title: null, branch: null, path: null })).toBe('ATR-6'));

    it('N2 unparseable tag counts as absent', () =>
        expect(resolveIssue({ tag: 'ATR-6:builder', title: null, branch: 'atr-8-x', path: null })).toBe('ATR-8'));

    it('N2: malformed tags do not gain branch-only shorthand or namespace syntax', () => {
        for (const tag of ['feature/ATR-6-build', 'ATR_6-build', 'ATR6-build']) {
            expect(resolveIssue({ tag, title: null, branch: 'atr-8-x', path: null })).toBe('ATR-8');
        }
    });

    it('N1 path alone resolves', () =>
        expect(resolveIssue({ tag: null, title: null, branch: null, path: '/w/atr-9-x' })).toBe('ATR-9'));

    it('branch beats path', () =>
        expect(resolveIssue({ tag: null, title: null, branch: 'atr-8-x', path: '/w/atr-9-x' })).toBe('ATR-8'));

    it('a title without a leading id falls through to the branch', () =>
        expect(resolveIssue({ tag: null, title: 'Fix the login form', branch: 'atr-8-x', path: null })).toBe('ATR-8'));

    it('A1 must not let an everyday token that opens the title outrank the branch', () => {
        for (const title of ['SHA-256 hashing', 'GPT-5 eval harness', 'UTF-8 decoding fix']) {
            expect(resolveIssue({ tag: null, title, branch: 'atr-8-x', path: '/w/atr-8-x' }), title).toBe('ATR-8');
        }
    });

    it('A1 must not let a title token outrank the folder when there is no branch id', () =>
        expect(resolveIssue({ tag: null, title: 'SHA-256 hashing', branch: 'main', path: '/w/atr-9-x' })).toBe('ATR-9'));

    it('A1 a title id with the branch\'s project still wins over the branch', () =>
        expect(resolveIssue({ tag: null, title: 'ATR-7 x', branch: 'atr-8-x', path: '/w/atr-8-x' })).toBe('ATR-7'));

    it('A1 a title id with the folder\'s project wins when the branch names no issue', () =>
        expect(resolveIssue({ tag: null, title: 'ATR-7 x', branch: 'main', path: '/w/atr-9-x' })).toBe('ATR-7'));

    it('A1 a title id stands alone when neither branch nor folder names an issue', () =>
        expect(resolveIssue({ tag: null, title: 'ATR-7 x', branch: null, path: null })).toBe('ATR-7'));

    it('an ordinary compact folder name does not override a valid title', () =>
        expect(resolveIssue({ tag: null, title: 'ATR-6 build', branch: null, path: '/work/python3' })).toBe('ATR-6'));

    it('everything null gives null', () =>
        expect(resolveIssue({ tag: null, title: null, branch: null, path: null })).toBeNull());
});
