import { describe, expect, it } from 'vitest';

import { issueKeyFromBranch, issueKeyFromPath, issueKeyFromTitle } from './issueKey';

describe('issueKeyFromBranch', () => {
    it('reads the wq issue id at the start of a work branch', () => {
        expect(issueKeyFromBranch('atr-6-overlay-fork-of-happier-s-app')).toBe('ATR-6');
        expect(issueKeyFromBranch('HUB-59')).toBe('HUB-59');
    });

    it('N5: slash-delimited branches preserve canonical issue keys', () => {
        expect(issueKeyFromBranch('feature/atr-6-x')).toBe('ATR-6');
        expect(issueKeyFromBranch('atr-13/foo')).toBe('ATR-13');
        expect(issueKeyFromBranch('feature/PROJECT-14-change')).toBe('PROJECT-14');
        expect(issueKeyFromBranch('feature/atr-6.5-release')).toBeNull();
    });

    it.todo('N4: a branch that looks like a key but is not a wq project stays unassigned; item 2.7 owns the authoritative wq inventory');
    it.todo('N4: folders such as my-app-2 and node-22 must not invent issues; item 2.7 owns the authoritative wq inventory');
    it.each([['atr_5', 'ATR-5'], ['ATR13', 'ATR-13']])('N5: branch and folder %s resolve to %s', (input, expected) => {
        expect(issueKeyFromBranch(input)).toBe(expected);
        expect(issueKeyFromPath(`/work/${input}`)).toBe(expected);
    });

    it('ignores branches without a leading issue id', () => {
        expect(issueKeyFromBranch('main')).toBeNull();
        expect(issueKeyFromBranch('ui-web-v0')).toBeNull();
        expect(issueKeyFromBranch(null)).toBeNull();
    });
});

describe('issueKeyFromPath', () => {
    it('uses the deepest path segment that names an issue', () => {
        expect(issueKeyFromPath('/home/u/dev/wt/hub-59-cards/apps/ui')).toBe('HUB-59');
        expect(issueKeyFromPath('/home/u/dev/mvp-80-a/wt/atr-6-b')).toBe('ATR-6');
    });

    it('reads a key at the end of a <repo>-<proj>-<n> worktree folder', () => {
        expect(issueKeyFromPath('/home/u/dev/unclank-hub-59')).toBe('HUB-59');
        expect(issueKeyFromPath('/home/u/dev/unclank-hub-59-review/src')).toBe('HUB-59');
        expect(issueKeyFromPath('/home/u/dev/neural-network-playground')).toBeNull();
    });

    it('returns null for plain project folders', () => {
        expect(issueKeyFromPath('/home/u/dev')).toBeNull();
        expect(issueKeyFromPath('')).toBeNull();
    });
});

describe('issueKeyFromTitle', () => {
    it('reads an issue id that opens a session title', () => {
        expect(issueKeyFromTitle('ATR-6 build')).toBe('ATR-6');
        expect(issueKeyFromTitle('ATR-6: build')).toBe('ATR-6');
        expect(issueKeyFromTitle('atr-6-build')).toBe('ATR-6');
        expect(issueKeyFromTitle('ATR-6')).toBe('ATR-6');
    });

    it('A7 reads an id in brackets or followed by a comma, full stop or slash', () => {
        expect(issueKeyFromTitle('[ATR-6] build')).toBe('ATR-6');
        expect(issueKeyFromTitle('ATR-6, build')).toBe('ATR-6');
        expect(issueKeyFromTitle('ATR-6. build')).toBe('ATR-6');
        expect(issueKeyFromTitle('ATR-6/ATR-7 merge')).toBe('ATR-6');
    });

    it('must not read a version number as an id with a full stop', () => {
        expect(issueKeyFromTitle('ATR-6.5 release')).toBeNull();
    });

    it('must not read an id glued to a word, buried in the title, or from nothing', () => {
        expect(issueKeyFromTitle('ATR-6build')).toBeNull();
        expect(issueKeyFromTitle('Fix ATR-6 build')).toBeNull();
        expect(issueKeyFromTitle(null)).toBeNull();
        expect(issueKeyFromTitle('')).toBeNull();
    });
});
