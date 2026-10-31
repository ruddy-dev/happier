import { describe, expect, it } from 'vitest';

import { issueKeyFromBranch, issueKeyFromPath } from './issueKey';

describe('issueKeyFromBranch', () => {
    it('reads the wq issue id at the start of a work branch', () => {
        expect(issueKeyFromBranch('atr-6-overlay-fork-of-happier-s-app')).toBe('ATR-6');
        expect(issueKeyFromBranch('HUB-59')).toBe('HUB-59');
    });

    it('ignores branches without a leading issue id', () => {
        expect(issueKeyFromBranch('main')).toBeNull();
        expect(issueKeyFromBranch('feature/atr-6-x')).toBeNull();
        expect(issueKeyFromBranch('ui-web-v0')).toBeNull();
        expect(issueKeyFromBranch(null)).toBeNull();
    });
});

describe('issueKeyFromPath', () => {
    it('uses the deepest path segment that names an issue', () => {
        expect(issueKeyFromPath('/home/u/dev/wt/hub-59-cards/apps/ui')).toBe('HUB-59');
        expect(issueKeyFromPath('/home/u/dev/mvp-80-a/wt/atr-6-b')).toBe('ATR-6');
    });

    it('returns null for plain project folders', () => {
        expect(issueKeyFromPath('/home/u/dev')).toBeNull();
        expect(issueKeyFromPath('')).toBeNull();
    });
});
