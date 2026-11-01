import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The desk fixture is dev tooling: with EXPO_PUBLIC_IP_FIXTURES unset, Metro must not even see its files,
// so a shipped bundle can't carry them. The watch-folder seam lets a linked git worktree export.
describe('apps/ui/metro.config.js (desk fixture and linked-install seams)', () => {
    const envSnapshot = { ...process.env };

    function requireFreshMetroConfig() {
        // Metro expects a CommonJS config; clear the require cache so each test sees its own env.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const resolved = require.resolve('../../metro.config.js');
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
        delete require.cache[resolved];
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        return require('../../metro.config.js');
    }

    function isBlocked(config: { resolver: { blockList: unknown } }, file: string): boolean {
        const list = Array.isArray(config.resolver.blockList) ? config.resolver.blockList : [config.resolver.blockList];
        return list.some((entry) => entry instanceof RegExp && entry.test(file));
    }

    const fixtureRoot = path.resolve(__dirname, '../ignorePrevious/fixtures');

    beforeEach(() => {
        vi.resetModules();
        process.env = { ...envSnapshot };
        delete process.env.EXPO_PUBLIC_IP_FIXTURES;
        delete process.env.HAPPIER_METRO_EXTRA_WATCH_FOLDERS;
    });

    afterEach(() => {
        vi.resetModules();
        process.env = { ...envSnapshot };
    });

    it('blocks the fixtures folder when the flag is off', () => {
        const config = requireFreshMetroConfig();
        expect(isBlocked(config, path.join(fixtureRoot, 'applyDeskFixture.ts'))).toBe(true);
        expect(isBlocked(config, path.join(fixtureRoot, 'desk-fixture.json'))).toBe(true);
        expect(isBlocked(config, path.join(fixtureRoot, 'nested', 'CoordinatorBodyStub.tsx'))).toBe(true);
        expect(isBlocked(config, fixtureRoot.replace(/\//g, '\\') + '\\desk-fixture.json')).toBe(true);
    });

    it('blocks them for any value but 1', () => {
        process.env.EXPO_PUBLIC_IP_FIXTURES = '0';
        const config = requireFreshMetroConfig();
        expect(isBlocked(config, path.join(fixtureRoot, 'applyDeskFixture.ts'))).toBe(true);
    });

    it('leaves the rest of the overlay alone when the flag is off', () => {
        const config = requireFreshMetroConfig();
        const overlay = path.resolve(__dirname, '../ignorePrevious');
        expect(isBlocked(config, path.join(overlay, 'screens', 'DeskScreen.tsx'))).toBe(false);
        expect(isBlocked(config, path.join(overlay, 'fixturesElsewhere', 'a.ts'))).toBe(false);
        expect(isBlocked(config, path.resolve(__dirname, '../app/(app)/dev/desk-fixture.tsx'))).toBe(false);
    });

    it('does not block the fixtures folder when the flag is on', () => {
        process.env.EXPO_PUBLIC_IP_FIXTURES = '1';
        const config = requireFreshMetroConfig();
        expect(isBlocked(config, path.join(fixtureRoot, 'applyDeskFixture.ts'))).toBe(false);
        expect(isBlocked(config, path.join(fixtureRoot, 'desk-fixture.json'))).toBe(false);
    });

    it('adds no watch folder unless HAPPIER_METRO_EXTRA_WATCH_FOLDERS is set', () => {
        const before = requireFreshMetroConfig().watchFolders.slice();
        expect(before).not.toContain(path.resolve('/linked/install/node_modules'));
        process.env.HAPPIER_METRO_EXTRA_WATCH_FOLDERS = '';
        expect(requireFreshMetroConfig().watchFolders).toEqual(before);
    });

    it('watches every folder of the delimited list once, ignoring blanks', () => {
        const a = path.resolve('/linked/install/node_modules');
        const b = path.resolve('/linked/install/apps/ui/node_modules');
        process.env.HAPPIER_METRO_EXTRA_WATCH_FOLDERS = [a, ' ', b, a].join(path.delimiter);
        const folders: string[] = requireFreshMetroConfig().watchFolders;
        expect(folders).toContain(a);
        expect(folders).toContain(b);
        expect(folders.filter((f) => f === a)).toHaveLength(1);
        expect(folders).not.toContain('');
    });
});
