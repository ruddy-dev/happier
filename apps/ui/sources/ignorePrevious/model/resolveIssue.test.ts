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

    it('N1 path alone resolves', () =>
        expect(resolveIssue({ tag: null, title: null, branch: null, path: '/w/atr-9-x' })).toBe('ATR-9'));

    it('branch beats path', () =>
        expect(resolveIssue({ tag: null, title: null, branch: 'atr-8-x', path: '/w/atr-9-x' })).toBe('ATR-8'));

    it('a title without a leading id falls through to the branch', () =>
        expect(resolveIssue({ tag: null, title: 'Fix the login form', branch: 'atr-8-x', path: null })).toBe('ATR-8'));

    it('everything null gives null', () =>
        expect(resolveIssue({ tag: null, title: null, branch: null, path: null })).toBeNull());
});
